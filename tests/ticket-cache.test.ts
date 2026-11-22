import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, createUser, resetDb } from './helpers';
import { createHold, cancelBooking, reconcileTicketCache } from '../src/services/booking.service';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/config/redis';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

function cacheKey(eventId: string) {
  return `event:${eventId}:tickets`;
}

describe('Redis ticket-cache fast path', () => {
  it('reserves via the Redis fast path and keeps Postgres and Redis in sync', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    // First hold is a cache miss: it seeds the cache from the pre-decrement
    // Postgres read and does not itself reflect this request's decrement
    // (by design — this request's correctness never depended on the
    // cache). Reconcile once to get a known-good baseline for Redis, then
    // exercise the actual fast path on the next hold.
    await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    await reconcileTicketCache(event.id);
    const seeded = await redis.get(cacheKey(event.id));
    expect(seeded).toBe('4');

    const { user: customer2 } = await createUser('CUSTOMER');
    await createHold({ userId: customer2.id, eventId: event.id, ticketsCount: 2 });

    const cached = await redis.get(cacheKey(event.id));
    expect(cached).toBe('2');

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(2);
  });

  it('rejects immediately as SOLD_OUT off the Redis cache without the request needing Postgres to say so', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 1);

    // Seed the cache directly at 0, simulating a hot event that's already
    // known to be sold out.
    await redis.set(cacheKey(event.id), 0);

    await expect(
      createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 }),
    ).rejects.toMatchObject({ code: 'SOLD_OUT' });

    // Postgres was never touched: availableTickets is still the original 1.
    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(1);
  });

  it('falls through to Postgres on a cache miss and seeds the cache for next time', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 3);

    const beforeKey = await redis.get(cacheKey(event.id));
    expect(beforeKey).toBeNull();

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    expect(booking.status).toBe('PENDING');

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(2);

    // The cache is seeded from the pre-decrement Postgres read (3), not
    // this request's own post-decrement result — the request's correctness
    // never depended on the cache, only on the Postgres CTE above. The
    // point of this test is that the key now exists for next time.
    const afterKey = await redis.get(cacheKey(event.id));
    expect(afterKey).toBe('3');
  });

  it('releases tickets back to both Postgres and the Redis cache on cancellation', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    // Prime the cache to a known, correct value first (see note above about
    // cache-miss seeding being pre-decrement), so the fast path below is
    // exercised deterministically.
    await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    await reconcileTicketCache(event.id);
    expect(await redis.get(cacheKey(event.id))).toBe('4');

    const { user: customer2 } = await createUser('CUSTOMER');
    const booking = await createHold({ userId: customer2.id, eventId: event.id, ticketsCount: 2 });

    const afterHold = await redis.get(cacheKey(event.id));
    expect(afterHold).toBe('2');

    await cancelBooking(booking.id, customer2.id);

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(4);

    const afterCancel = await redis.get(cacheKey(event.id));
    expect(afterCancel).toBe('4');
  });

  it('never overbooks even when the Redis cache is corrupted to say more tickets exist than Postgres has', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 1);

    // Postgres truth: 1 ticket available. Corrupt the cache to claim 10.
    await redis.set(cacheKey(event.id), 10);

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    expect(booking.status).toBe('PENDING');

    // Second hold: Redis says "reserved" (cache thinks 9 left), but
    // Postgres's own guarded UPDATE must catch that availableTickets is
    // actually 0 now and reject it.
    const { user: customer2 } = await createUser('CUSTOMER');
    await expect(
      createHold({ userId: customer2.id, eventId: event.id, ticketsCount: 1 }),
    ).rejects.toMatchObject({ code: 'SOLD_OUT' });

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(0);

    // The rejected reservation must have been rolled back in Redis too.
    const cached = await redis.get(cacheKey(event.id));
    expect(Number(cached)).toBe(9);
  });

  it('rolls back the speculative Redis reservation if the Postgres write throws', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    await reconcileTicketCache(event.id);
    expect(await redis.get(cacheKey(event.id))).toBe('5');

    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection reset'));

    await expect(
      createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 }),
    ).rejects.toThrow('connection reset');
    spy.mockRestore();

    // Postgres never committed anything, so the speculative Redis decrement
    // from the "reserved" branch must have been put back — otherwise this
    // event would wrongly reject the next request as sold out even though
    // nothing was ever actually taken.
    expect(await redis.get(cacheKey(event.id))).toBe('5');

    const { user: customer2 } = await createUser('CUSTOMER');
    const booking = await createHold({ userId: customer2.id, eventId: event.id, ticketsCount: 1 });
    expect(booking.status).toBe('PENDING');
  });

  it('reconcileTicketCache corrects a wrong Redis value back to match Postgres', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const event = await createEvent(organizer.id, 7);

    await redis.set(cacheKey(event.id), 999);

    await reconcileTicketCache(event.id);

    const cached = await redis.get(cacheKey(event.id));
    expect(Number(cached)).toBe(7);
  });
});
