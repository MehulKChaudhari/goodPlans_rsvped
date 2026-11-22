import { Queue } from 'bullmq';
import { redis } from '../config/redis';
import { QUEUE_NAMES } from './queue-names';
import { defaultJobOptions } from './default-job-options';

export interface EventUpdateNotificationJob {
  eventId: string;
  changedFields: string[];
}

export const eventUpdateNotificationQueue = new Queue<EventUpdateNotificationJob>(
  QUEUE_NAMES.EVENT_UPDATE_NOTIFICATION,
  { connection: redis, defaultJobOptions },
);
