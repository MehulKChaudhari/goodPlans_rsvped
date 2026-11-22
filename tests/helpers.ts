import { randomUUID } from 'node:crypto';
import { Role } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { signAccessToken } from '../src/lib/jwt';

let counter = 0;

export async function createUser(role: Role) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      name: `Test ${role} ${counter}`,
      email: `test-${role.toLowerCase()}-${counter}-${Date.now()}@example.com`,
      passwordHash: 'unused-in-tests',
      role,
    },
  });
  // These tests exercise event/booking routes, not session lifecycle, so a
  // fresh sid with no backing Session row is fine: authenticate() only
  // verifies the JWT, it doesn't look sessions up (only refresh/logout do).
  const accessToken = signAccessToken(user.id, user.role, randomUUID());
  return { user, accessToken };
}

export async function createEvent(organizerId: string, totalTickets: number) {
  return prisma.event.create({
    data: {
      title: 'Test Event',
      description: 'desc',
      date: new Date(Date.now() + 86_400_000),
      location: 'Test Arena',
      totalTickets,
      availableTickets: totalTickets,
      priceCents: 1000,
      organizerId,
    },
  });
}

export async function resetDb() {
  await prisma.booking.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}
