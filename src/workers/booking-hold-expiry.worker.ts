import { Job, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { logger } from '../config/logger';
import { QUEUE_NAMES } from '../queues/queue-names';
import { BookingHoldExpiryJob } from '../queues/booking-hold-expiry.queue';
import { expireHold } from '../services/booking.service';

export function startBookingHoldExpiryWorker(): Worker<BookingHoldExpiryJob> {
  const worker = new Worker<BookingHoldExpiryJob>(
    QUEUE_NAMES.BOOKING_HOLD_EXPIRY,
    async (job: Job<BookingHoldExpiryJob>) => {
      await expireHold(job.data.bookingId);
    },
    { connection: redis, concurrency: 10 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'booking-hold-expiry job failed');
  });

  return worker;
}
