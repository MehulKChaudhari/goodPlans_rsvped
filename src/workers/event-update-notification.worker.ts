import { Job, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { prisma } from '../lib/prisma';
import { notifier } from '../lib/notifier';
import { QUEUE_NAMES } from '../queues/queue-names';
import { EventUpdateNotificationJob } from '../queues/event-update-notification.queue';

export function startEventUpdateNotificationWorker(): Worker<EventUpdateNotificationJob> {
  const worker = new Worker<EventUpdateNotificationJob>(
    QUEUE_NAMES.EVENT_UPDATE_NOTIFICATION,
    async (job: Job<EventUpdateNotificationJob>) => {
      const event = await prisma.event.findUnique({ where: { id: job.data.eventId } });
      if (!event) {
        logger.warn({ eventId: job.data.eventId }, 'Skipping event-update notification: event not found');
        return;
      }

      // Active holders of this event: PENDING or CONFIRMED bookings only.
      const bookings = await prisma.booking.findMany({
        where: { eventId: event.id, status: { in: ['PENDING', 'CONFIRMED'] } },
        include: { user: true },
      });

      const recipients = new Map(bookings.map((b) => [b.user.email, b.user]));
      for (const user of recipients.values()) {
        await notifier.sendEmail(
          user.email,
          `Event updated: ${event.title}`,
          `Hi ${user.name}, the event "${event.title}" you booked tickets for was just updated (fields changed: ${job.data.changedFields.join(', ')}). New date: ${event.date.toISOString()}, location: ${event.location}.`,
        );
      }
    },
    { connection: redis, concurrency: 5 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'event-update-notification job failed');
  });

  return worker;
}
