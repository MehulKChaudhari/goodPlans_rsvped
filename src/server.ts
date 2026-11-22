import 'dotenv/config';
import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';
import { redis } from './config/redis';
import { startBookingConfirmationWorker } from './workers/booking-confirmation.worker';
import { startEventUpdateNotificationWorker } from './workers/event-update-notification.worker';
import { startBookingHoldExpiryWorker } from './workers/booking-hold-expiry.worker';

// Workers run in-process for this exercise's time budget. At real scale,
// deploy `src/worker.ts`-style entrypoints as a separate service so API
// request latency and job-processing load scale independently.
const workers = [
  startBookingConfirmationWorker(),
  startEventUpdateNotificationWorker(),
  startBookingHoldExpiryWorker(),
];

const server = app.listen(env.port, () => {
  logger.info(`goodPlans API listening on :${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close();
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
