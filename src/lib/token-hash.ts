import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Hashes an opaque, already-high-entropy token (a signed JWT) for storage.
 * Deliberately not bcrypt: bcrypt truncates its input at 72 bytes, and a JWT
 * is longer than that, so two tokens sharing the same first 72 bytes (e.g.
 * the same header and leading claims, differing only in a trailing `jti` or
 * `exp`) would hash identically and compare as equal. bcrypt's slow hashing
 * is also solving a problem this doesn't have — the input is already
 * unguessable, not a short human password — so a plain fixed-length digest,
 * compared in constant time, is both correct and cheaper.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatchesHash(token: string, hash: string): boolean {
  const candidate = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
