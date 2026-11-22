import { Job, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { prisma } from '../lib/prisma';
import { notifier } from '../lib/notifier';
import { QUEUE_NAMES } from '../queues/queue-names';
import { BookingConfirmationJob } from '../queues/booking-confirmation.queue';

export function startBookingConfirmationWorker(): Worker<BookingConfirmationJob> {
  const worker = new Worker<BookingConfirmationJob>(
    QUEUE_NAMES.BOOKING_CONFIRMATION,
    async (job: Job<BookingConfirmationJob>) => {
      const booking = await prisma.booking.findUnique({
        where: { id: job.data.bookingId },
        include: { event: true, user: true },
      });
      if (!booking || booking.status !== 'CONFIRMED') {
        logger.warn({ bookingId: job.data.bookingId }, 'Skipping confirmation email: booking not CONFIRMED');
        return;
      }

      await notifier.sendEmail(
        booking.user.email,
        `Booking confirmed: ${booking.event.title}`,
        `Hi ${booking.user.name}, your booking for ${booking.ticketsCount} ticket(s) to "${booking.event.title}" on ${booking.event.date.toISOString()} is confirmed.`,
      );
    },
    { connection: redis, concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'booking-confirmation job failed');
  });

  return worker;
}
