import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createEvent, createUser, resetDb } from './helpers';
import { createHold } from '../src/services/booking.service';
import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('booking idempotency', () => {
  it('returns the original booking and does not double-decrement on a retried request', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    const key = 'client-generated-key-1';
    const first = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 2, idempotencyKey: key });
    const retry = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 2, idempotencyKey: key });

    expect(retry.id).toBe(first.id);

    const bookingCount = await prisma.booking.count({ where: { eventId: event.id } });
    expect(bookingCount).toBe(1);

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(3); // decremented once, not twice
  });

  it('allows the same customer to make a second, independent booking without a key', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });
    await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 1 });

    const bookingCount = await prisma.booking.count({ where: { eventId: event.id } });
    expect(bookingCount).toBe(2);
  });
});
