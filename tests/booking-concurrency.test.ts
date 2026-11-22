import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createEvent, createUser, resetDb } from './helpers';
import { createHold, cancelBooking } from '../src/services/booking.service';
import { prisma } from '../src/lib/prisma';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('booking creation race (overbooking)', () => {
  it('never sells more tickets than exist when N concurrent holds exceed availability', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const totalTickets = 10;
    const event = await createEvent(organizer.id, totalTickets);

    const customers = await Promise.all(Array.from({ length: 30 }, () => createUser('CUSTOMER')));

    const results = await Promise.allSettled(
      customers.map((c) => createHold({ userId: c.user.id, eventId: event.id, ticketsCount: 1 })),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    expect(succeeded).toBe(totalTickets);
    expect(failed).toBe(30 - totalTickets);

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(finalEvent.availableTickets).toBe(0);

    const confirmedCount = await prisma.booking.count({ where: { eventId: event.id, status: 'PENDING' } });
    expect(confirmedCount).toBe(totalTickets);
  });
});

describe('booking cancellation race (double-release)', () => {
  it('only releases tickets once when the same booking is cancelled concurrently', async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: customer } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 5);

    const booking = await createHold({ userId: customer.id, eventId: event.id, ticketsCount: 2 });

    const afterHold = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(afterHold.availableTickets).toBe(3);

    // Fire 10 concurrent cancel requests for the SAME booking.
    await Promise.allSettled(
      Array.from({ length: 10 }, () => cancelBooking(booking.id, customer.id)),
    );

    const finalEvent = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    const finalBooking = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    expect(finalBooking.status).toBe('CANCELLED');
    // Must be released exactly once: 3 (held) + 2 (released) = 5, never 7, 9, ...
    expect(finalEvent.availableTickets).toBe(5);
    expect(finalEvent.availableTickets).toBeLessThanOrEqual(finalEvent.totalTickets);
  });
});
