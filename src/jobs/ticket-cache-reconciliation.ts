import { prisma } from '../lib/prisma';
import { logger } from '../config/logger';
import { reconcileTicketCache } from '../services/booking.service';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Periodically re-syncs every event's Redis ticket-count cache back to
 * Postgres's true `availableTickets`. The hot path (`createHold`) and
 * release path (`cancelBooking`/`expireHold`) already keep the cache close
 * to correct, but this sweep is the backstop for any drift that slips
 * through (a Redis flush, a missed release, manual data fixes, etc.).
 *
 * Deliberately simple for this exercise's scale: it re-syncs every event on
 * each tick rather than tracking which ones are dirty.
 */
export function startTicketCacheReconciliation(intervalMs: number = RECONCILE_INTERVAL_MS): NodeJS.Timeout {
  const tick = async () => {
    try {
      const events = await prisma.event.findMany({ select: { id: true } });
      for (const event of events) {
        await reconcileTicketCache(event.id);
      }
    } catch (err) {
      logger.error({ err }, 'ticket-cache-reconciliation: sweep failed');
    }
  };

  return setInterval(() => {
    void tick();
  }, intervalMs);
}
