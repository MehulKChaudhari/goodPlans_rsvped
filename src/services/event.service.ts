import { Event } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { eventUpdateNotificationQueue } from '../queues/event-update-notification.queue';

export interface CreateEventInput {
  organizerId: string;
  title: string;
  description: string;
  date: Date;
  location: string;
  totalTickets: number;
  priceCents: number;
}

export async function createEvent(input: CreateEventInput): Promise<Event> {
  return prisma.event.create({
    data: {
      organizerId: input.organizerId,
      title: input.title,
      description: input.description,
      date: input.date,
      location: input.location,
      totalTickets: input.totalTickets,
      availableTickets: input.totalTickets,
      priceCents: input.priceCents,
    },
  });
}

export async function listEvents(page: number, pageSize: number) {
  const [items, total] = await Promise.all([
    prisma.event.findMany({
      orderBy: { date: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.event.count(),
  ]);
  return { items, total, page, pageSize };
}

export async function getEventById(eventId: string): Promise<Event> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw AppError.notFound('Event not found');
  return event;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  date?: Date;
  location?: string;
  priceCents?: number;
}

export async function updateEvent(eventId: string, organizerId: string, input: UpdateEventInput): Promise<Event> {
  const event = await requireOwnedEvent(eventId, organizerId);

  const changedFields = Object.keys(input).filter(
    (key) => input[key as keyof UpdateEventInput] !== undefined,
  );
  if (changedFields.length === 0) return event;

  const updated = await prisma.event.update({ where: { id: eventId }, data: input });

  await eventUpdateNotificationQueue.add('notify-update', { eventId, changedFields });

  return updated;
}

export async function deleteEvent(eventId: string, organizerId: string): Promise<void> {
  await requireOwnedEvent(eventId, organizerId);

  await prisma.$transaction(async (tx) => {
    const activeBookings = await tx.booking.count({
      where: { eventId, status: { in: ['PENDING', 'CONFIRMED'] } },
    });
    if (activeBookings > 0) {
      throw AppError.conflict('Cannot delete an event with active bookings', 'EVENT_HAS_BOOKINGS');
    }
    await tx.event.delete({ where: { id: eventId } });
  });
}

async function requireOwnedEvent(eventId: string, organizerId: string): Promise<Event> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw AppError.notFound('Event not found');
  if (event.organizerId !== organizerId) {
    throw AppError.forbidden('You do not own this event');
  }
  return event;
}
