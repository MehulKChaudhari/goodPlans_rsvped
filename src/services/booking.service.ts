import { randomUUID } from 'node:crypto';
import { Booking, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { env } from '../config/env';
import { bookingConfirmationQueue } from '../queues/booking-confirmation.queue';
import { cancelHoldExpiry, scheduleHoldExpiry } from '../queues/booking-hold-expiry.queue';

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
 */
export async function createHold(input: CreateHoldInput): Promise<Booking> {
  if (input.idempotencyKey) {
    const existing = await prisma.booking.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return existing;
  }

  const bookingId = randomUUID();
  const holdExpiresAt = new Date(Date.now() + env.bookingHoldTtlMs);

  const rows = await prisma.$queryRaw<Booking[]>(Prisma.sql`
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

  if (rows.length === 0) {
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
  await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || !fromStatuses.includes(booking.status as 'PENDING' | 'CONFIRMED')) {
      return;
    }

    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: fromStatuses } },
      data: {
        status: toStatus,
        cancelledAt: toStatus === 'CANCELLED' ? new Date() : undefined,
      },
    });

    if (updated.count === 0) return;

    await tx.event.update({
      where: { id: booking.eventId },
      data: { availableTickets: { increment: booking.ticketsCount } },
    });
  });
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
