import { redis } from '../config/redis';
import { logger } from '../config/logger';

/**
 * Redis-backed fast path in front of Postgres's `Event.availableTickets`.
 *
 * Postgres remains the single source of truth. This cache exists purely to
 * let `createHold` reject an obviously-sold-out event (or reserve tickets
 * for a likely-to-succeed one) without taking the Postgres row lock that
 * serializes all holds for one event. Every write here is advisory: the
 * Postgres CTE in `booking.service.ts` still re-checks availability with its
 * own guarded UPDATE, so a stale or corrupted cache can only ever cost a
 * wasted round trip, never an overbooked seat.
 *
 * Every function below fails open on Redis errors (connection refused,
 * timeout, etc.): it logs a warning and resolves to "cache unavailable"
 * rather than throwing, so a Redis outage degrades this feature back to
 * "always fall through to Postgres," never to "block valid bookings."
 */

function keyFor(eventId: string): string {
  return `event:${eventId}:tickets`;
}

// Atomic reserve: returns -1 on cache miss (key doesn't exist), -2 when the
// cached count is insufficient (sold out per the cache), or the new
// remaining count after a successful DECRBY.
const TRY_RESERVE_SCRIPT = `
local key = KEYS[1]
local count = tonumber(ARGV[1])
local current = redis.call('GET', key)
if current == false then
  return -1
end
current = tonumber(current)
if current < count then
  return -2
end
return redis.call('DECRBY', key, count)
`;

// Conditional release: only INCRBY if the key already exists. A missing key
// means we don't know true capacity, so creating it from nothing would be
// wrong; the next ensureCached() call will seed it correctly from Postgres.
const RELEASE_SCRIPT = `
local key = KEYS[1]
local count = tonumber(ARGV[1])
if redis.call('EXISTS', key) == 1 then
  redis.call('INCRBY', key, count)
end
return 1
`;

export type TryReserveResult =
  | { outcome: 'reserved'; remaining: number }
  | { outcome: 'sold_out' }
  | { outcome: 'cache_miss' };

/**
 * Lazily seeds the cache from a known-good Postgres read. A no-op if the key
 * already exists (NX), so two requests racing to seed the same event is
 * harmless: the loser's SET is simply ignored.
 */
export async function ensureCached(eventId: string, fallbackValue: number): Promise<void> {
  try {
    await redis.set(keyFor(eventId), fallbackValue, 'EX', 60 * 60 * 24, 'NX');
  } catch (err) {
    logger.warn({ err, eventId }, 'ticket-cache: ensureCached failed, continuing without cache');
  }
}

/**
 * Attempts to atomically reserve `ticketsCount` tickets against the cached
 * count for `eventId`. Never throws: any Redis error resolves to
 * 'cache_miss' so the caller falls through to the Postgres-backed path.
 */
export async function tryReserve(eventId: string, ticketsCount: number): Promise<TryReserveResult> {
  try {
    const result = await redis.eval(TRY_RESERVE_SCRIPT, 1, keyFor(eventId), ticketsCount);
    const value = Number(result);
    if (value === -1) return { outcome: 'cache_miss' };
    if (value === -2) return { outcome: 'sold_out' };
    return { outcome: 'reserved', remaining: value };
  } catch (err) {
    logger.warn({ err, eventId }, 'ticket-cache: tryReserve failed, falling back to Postgres');
    return { outcome: 'cache_miss' };
  }
}

/**
 * Puts `ticketsCount` tickets back into the cache (cancel/expire/rollback).
 * A no-op, not an error, if the key doesn't exist yet. Fails open: a Redis
 * error here is logged and swallowed — the Postgres write it follows is
 * already authoritative and already committed.
 */
export async function release(eventId: string, ticketsCount: number): Promise<void> {
  try {
    await redis.eval(RELEASE_SCRIPT, 1, keyFor(eventId), ticketsCount);
  } catch (err) {
    logger.warn({ err, eventId }, 'ticket-cache: release failed, cache may be stale until next reconcile');
  }
}

/**
 * Forces the cache back in line with Postgres's true value, unconditionally.
 * Used by the periodic reconciliation sweep and by anyone else who has just
 * read the authoritative count.
 */
export async function resync(eventId: string, correctValue: number): Promise<void> {
  try {
    await redis.set(keyFor(eventId), correctValue, 'EX', 60 * 60 * 24);
  } catch (err) {
    logger.warn({ err, eventId }, 'ticket-cache: resync failed');
  }
}
