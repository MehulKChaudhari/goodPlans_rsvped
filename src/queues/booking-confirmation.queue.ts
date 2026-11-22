import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUE_NAMES } from './queue-names';
import { defaultJobOptions } from './default-job-options';

export interface BookingConfirmationJob {
  bookingId: string;
}

export const bookingConfirmationQueue = new Queue<BookingConfirmationJob>(QUEUE_NAMES.BOOKING_CONFIRMATION, {
  connection: redis,
  defaultJobOptions,
});
