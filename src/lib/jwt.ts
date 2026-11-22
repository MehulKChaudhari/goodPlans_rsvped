import { randomUUID } from 'node:crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export function signAccessToken(userId: string, role: Role, sessionId: string) {
  return jwt.sign({ sub: userId, role, sid: sessionId }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessTtl,
  } as SignOptions);
}

/**
 * jti makes every issued refresh token unique even when two are signed for
 * the same session within the same second (same sub/sid/iat/exp would
 * otherwise produce byte-identical JWTs, which breaks rotation: the "old"
 * and "new" tokens would be indistinguishable).
 */
export function signRefreshToken(userId: string, sessionId: string) {
  return jwt.sign({ sub: userId, sid: sessionId, jti: randomUUID() }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshTtl,
  } as SignOptions);
}

export function verifyRefreshToken(token: string): { sub: string; sid: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string; sid: string };
}
