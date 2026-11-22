import { Worker } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEvent, createUser, resetDb } from './helpers';
import { createHold, confirmBooking } from '../src/services/booking.service';
import { prisma } from '../src/lib/prisma';
import { redis } from '../src/config/redis';
import { startBookingHoldExpiryWorker } from '../src/workers/booking-hold-expiry.worker';

let worker: Worker;

beforeAll(() => {
  worker = startBookingHoldExpiryWorker();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await worker.close();
  await prisma.$disconnect();
  redis.disconnect();
});

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('hold expiry', () => {
  it('releases tickets automatically once the hold TTL elapses without a confirm', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 2 });

    const held = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(held.availableTickets).toBe(3);

    // BOOKING_HOLD_TTL_MS=300 in .env.test; give the delayed job room to fire.
    await wait(1500);

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

    expect(finalBooking.status).toBe('EXPIRED');
    expect(finalEvent.availableTickets).toBe(5);
  });

  it('rejects a confirm attempt after the hold has already expired', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    await wait(1500);

    await expect(confirmBooking(booking.id, customer.id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a confirm that lands before expiry cancels the scheduled release', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    await confirmBooking(booking.id, customer.id);

    await wait(1500); // past the TTL the hold would have had

    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });

    expect(finalBooking.status).toBe('CONFIRMED');
    expect(finalEvent.availableTickets).toBe(4); // still held, not released
  });
});
