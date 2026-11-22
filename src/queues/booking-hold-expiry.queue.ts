import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUE_NAMES } from './queue-names';

export interface BookingHoldExpiryJob {
  bookingId: string;
}

export const bookingHoldExpiryQueue = new Queue<BookingHoldExpiryJob>(QUEUE_NAMES.BOOKING_HOLD_EXPIRY, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

export async function scheduleHoldExpiry(bookingId: string, delayMs: number): Promise<string> {
  const job = await bookingHoldExpiryQueue.add(
    'expire-hold',
    { bookingId },
    { delay: delayMs, jobId: `hold-expiry:${bookingId}` },
  );
  return job.id as string;
}

export async function cancelHoldExpiry(jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  const job = await bookingHoldExpiryQueue.getJob(jobId);
  if (job) {
    const state = await job.getState();
    if (state === 'delayed' || state === 'waiting') {
      await job.remove();
    }
  }
}
