import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
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

describe('RBAC and ownership', () => {
  it('rejects a CUSTOMER trying to create an event (route-level role gate)', async () => {
    const { user: customer, accessToken } = await createUser('CUSTOMER');
    void customer;

    const res = await request(app)
      .post('/api/events')
      .set('authorization', `Bearer ${accessToken}`)
      .send({
        title: 'Hack',
        description: 'desc',
        date: new Date(Date.now() + 86_400_000).toISOString(),
        location: 'Nowhere',
        totalTickets: 1,
        priceCents: 100,
      });

    expect(res.status).toBe(403);
  });

  it('rejects an ORGANIZER updating an event they do not own', async () => {
    const { user: owner } = await createUser('ORGANIZER');
    const { accessToken: intruderToken } = await createUser('ORGANIZER');
    const event = await createEvent(owner.id, 10);

    const res = await request(app)
      .patch(`/api/events/${event.id}`)
      .set('authorization', `Bearer ${intruderToken}`)
      .send({ location: 'Hijacked' });

    expect(res.status).toBe(403);
  });

  it("rejects a customer reading another customer's booking by id (closes the legacy IDOR gap)", async () => {
    const { user: organizer } = await createUser('ORGANIZER');
    const { user: ownerCustomer, accessToken: ownerToken } = await createUser('CUSTOMER');
    const { accessToken: intruderToken } = await createUser('CUSTOMER');
    const event = await createEvent(organizer.id, 10);

    const booking = await createHold({ userId: ownerCustomer.id, eventId: event.id, ticketsCount: 1 });

    const ownerRes = await request(app)
      .get(`/api/bookings/${booking.id}`)
      .set('authorization', `Bearer ${ownerToken}`);
    expect(ownerRes.status).toBe(200);

    const intruderRes = await request(app)
      .get(`/api/bookings/${booking.id}`)
      .set('authorization', `Bearer ${intruderToken}`);
    expect(intruderRes.status).toBe(404);
  });

  it('rejects an ORGANIZER hitting customer-only booking routes', async () => {
    const { accessToken } = await createUser('ORGANIZER');

    const res = await request(app).get('/api/bookings/my').set('authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(403);
  });
});
