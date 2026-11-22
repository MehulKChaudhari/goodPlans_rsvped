import { randomUUID } from 'node:crypto';
import { Booking, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { env } from '../config/env';
import { bookingConfirmationQueue } from '../queues/booking-confirmation.queue';
import { cancelHoldExpiry, scheduleHoldExpiry } from '../queues/booking-hold-expiry.queue';
import { ensureCached, release, resync, tryReserve } from '../lib/ticket-cache';

export interface CreateHoldInput {
  userId: string;
  eventId: string;
  ticketsCount: number;
  idempotencyKey?: string;
}

/**
 * Places a hold: atomically decrements Event.availableTickets only if enough
 * tickets remain, and inserts the PENDING booking in that same decrement.
 *
 * Written as a single CTE statement rather than a multi-query `$transaction`
 * (UPDATE, then INSERT, each a separate round-trip under an explicit
 * BEGIN/COMMIT). All concurrent holds on one event serialize on that event
 * row's lock regardless — that serialization is the price of the correctness
 * guarantee below — but a single round-trip holds the lock for roughly 1/3
 * to 1/4 as long as the four-round-trip version, which raises the ceiling on
 * how many holds-per-second one hot event can sustain. Load-tested in
 * load-test/run.ts; see README "Performance" section for before/after numbers.
 *
 * In front of that CTE sits a Redis fast path (`src/lib/ticket-cache.ts`):
 * an obviously-sold-out event is rejected off a Redis counter without ever
 * taking the Postgres row lock. The CTE above still runs its own guarded
 * UPDATE on the "reserved"/"cache miss" paths — it is the correctness
 * backstop, not an optimization that can be skipped — so a stale or
 * corrupted Redis entry can only cost a wasted round trip, never an
 * overbooked seat. See README Decisions Log #7.
 */
export async function createHold(input: CreateHoldInput): Promise<Booking> {
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existing;
  }

  const cacheResult = await tryReserve(input.eventId, input.ticketsCount);

  if (cacheResult.outcome === 'sold_out') {
    throw AppError.conflict('Not enough tickets available', 'SOLD_OUT');
  }

  if (cacheResult.outcome === 'cache_miss') {
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw AppError.notFound('Event not found');
    await ensureCached(input.eventId, event.availableTickets);
  }

  const bookingId = randomUUID();
  const holdExpiresAt = new Date(Date.now() + env.bookingHoldTtlMs);

  let rows: Booking[];
  try {
    rows = await prisma.$queryRaw<Booking[]>(Prisma.sql`
      WITH decremented AS (
        UPDATE "Event"
        SET "availableTickets" = "availableTickets" - ${input.ticketsCount}
        WHERE id = ${input.eventId} AND "availableTickets" >= ${input.ticketsCount}
        RETURNING id
      )
      INSERT INTO "Booking" (id, "userId", "eventId", "ticketsCount", status, "idempotencyKey", "holdExpiresAt", "createdAt", "updatedAt")
      SELECT ${bookingId}, ${input.userId}, ${input.eventId}, ${input.ticketsCount}, 'PENDING'::"BookingStatus", ${input.idempotencyKey ?? null}, ${holdExpiresAt}, now(), now()
      FROM decremented
      RETURNING *
    `);
  } catch (err) {
    // The Postgres write never happened, so a speculative Redis reservation
    // from the "reserved" branch above must not survive this failure — left
    // in place, it would wrongly reject the next request for this event as
    // sold out until the next reconciliation sweep, even though no ticket
    // was ever actually taken.
    if (cacheResult.outcome === 'reserved') {
      await release(input.eventId, input.ticketsCount);
    }
    throw err;
  }

  if (rows.length === 0) {
    if (cacheResult.outcome === 'reserved') {
      // The Redis cache said tickets were available but Postgres's own
      // guarded UPDATE disagreed — the cache had drifted stale-high. Put
      // the speculative reservation back so it doesn't leak.
      await release(input.eventId, input.ticketsCount);
    }
    const event = await prisma.event.findUnique({ where: { id: input.eventId } });
    if (!event) throw AppError.notFound('Event not found');
    throw AppError.conflict('Not enough tickets available', 'SOLD_OUT');
  }

  const jobId = await scheduleHoldExpiry(bookingId, env.bookingHoldTtlMs);
  return prisma.booking.update({ where: { id: bookingId }, data: { holdJobId: jobId } });
}

/**
 * Confirms a still-PENDING hold before its TTL elapses. Guarded the same way
 * as the decrement above: only flips status if it is currently PENDING, so a
 * confirm racing an expiry worker can't both "win".
 */
export async function confirmBooking(bookingId: string, userId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId !== userId) throw AppError.notFound('Booking not found');

  if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() < Date.now()) {
    throw AppError.conflict('This hold has expired', 'HOLD_EXPIRED');
  }

  const updated = await prisma.booking.updateMany({
    where: { id: bookingId, status: 'PENDING', holdExpiresAt: { gt: new Date() } },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
  });

  if (updated.count === 0) {
    throw AppError.conflict('Booking is not in a confirmable state', 'INVALID_STATE');
  }

  await cancelHoldExpiry(booking.holdJobId);
  await bookingConfirmationQueue.add('send-confirmation', { bookingId });

  return (await prisma.booking.findUnique({ where: { id: bookingId } }))!;
}

/**
 * Cancels a PENDING or CONFIRMED booking and releases its tickets back to
 * the event — atomically, guarded by the booking's current status so two
 * concurrent cancels (the bug found in the legacy implementation) can only
 * release the tickets once.
 */
export async function cancelBooking(bookingId: string, userId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId !== userId) throw AppError.notFound('Booking not found');

  await releaseBooking(bookingId, ['PENDING', 'CONFIRMED'], 'CANCELLED');
  await cancelHoldExpiry(booking.holdJobId);

  return (await prisma.booking.findUnique({ where: { id: bookingId } }))!;
}

/**
 * Called by the delayed hold-expiry job. If the booking is still PENDING by
 * the time the job fires, releases its tickets and marks it EXPIRED. Guarded
 * by status so a confirm that landed first (and already flipped status away
 * from PENDING) makes this a no-op.
 */
export async function expireHold(bookingId: string): Promise<void> {
  await releaseBooking(bookingId, ['PENDING'], 'EXPIRED');
}

async function releaseBooking(
  bookingId: string,
  fromStatuses: Array<'PENDING' | 'CONFIRMED'>,
  toStatus: 'CANCELLED' | 'EXPIRED',
): Promise<void> {
  const released = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !fromStatuses.includes(booking.status as 'PENDING' | 'CONFIRMED')) {
      return null;
    }

    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: fromStatuses } },
      data: {
        status: toStatus,
        cancelledAt: toStatus === 'CANCELLED' ? new Date() : undefined,
      },
    });

    if (updated.count === 0) return null;

    await tx.event.update({
      where: { id: booking.eventId },
      data: { availableTickets: { increment: booking.ticketsCount } },
    });

    return { eventId: booking.eventId, ticketsCount: booking.ticketsCount };
  });

  // Redis is never part of the Postgres transaction. The Postgres write is
  // already committed and authoritative by this point; the cache update is
  // best-effort bookkeeping on top of it (release() itself fails open, so
  // this can't throw and undo the commit above).
  if (released) {
    await release(released.eventId, released.ticketsCount);
  }
}

/**
 * Re-syncs the Redis-cached ticket count for one event back to Postgres's
 * true `availableTickets`. Used both ad hoc and by the periodic
 * reconciliation sweep (`src/jobs/ticket-cache-reconciliation.ts`) to undo
 * any drift the fast path's advisory writes may have introduced.
 */
export async function reconcileTicketCache(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  await resync(eventId, event.availableTickets);
}

export async function getBookingById(bookingId: string, userId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.userId !== userId) throw AppError.notFound('Booking not found');
  return booking;
}

export async function listMyBookings(userId: string, page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.booking.count({ where: { userId } }),
  ]);
  return { items, total, page, pageSize };
}
