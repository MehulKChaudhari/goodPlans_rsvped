import 'dotenv/config';
import { app } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './lib/prisma';
import { redis } from './config/redis';
import { startTicketCacheReconciliation } from './jobs/ticket-cache-reconciliation';

const server = app.listen(env.port, () => {
  logger.info(`goodPlans API listening on :${env.port} (${env.nodeEnv})`);
});

// Tied to booking-serving capacity (the ticket cache it corrects only
// matters to this process's hot path), so it lives with the API process
// rather than the worker entrypoint.
const ticketCacheReconciliationInterval = startTicketCacheReconciliation();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close();
  clearInterval(ticketCacheReconciliationInterval);
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
