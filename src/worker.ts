import 'dotenv/config';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';
import { redis } from './config/redis';
import { startBookingConfirmationWorker } from './workers/booking-confirmation.worker';
import { startEventUpdateNotificationWorker } from './workers/event-update-notification.worker';
import { startBookingHoldExpiryWorker } from './workers/booking-hold-expiry.worker';

// Standalone entrypoint for the job-processing side: no HTTP server here, just
// the three BullMQ workers. Deployed as its own Railway service so API
// request latency and job-processing load scale independently.
const workers = [
  startBookingConfirmationWorker(),
  startEventUpdateNotificationWorker(),
  startBookingHoldExpiryWorker(),
];

logger.info('goodPlans worker process started');

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
