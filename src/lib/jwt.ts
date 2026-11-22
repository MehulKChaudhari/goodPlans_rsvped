import jwt, { SignOptions } from 'jsonwebtoken';
import { Role } from '@prisma/client';
import { env } from '../config/env';

export function signAccessToken(userId: string, role: Role) {
  return jwt.sign({ sub: userId, role }, env.jwtAccessSecret, {
    expiresIn: env.jwtAccessTtl,
  } as SignOptions);
}

export function signRefreshToken(userId: string) {
  return jwt.sign({ sub: userId }, env.jwtRefreshSecret, {
    expiresIn: env.jwtRefreshTtl,
  } as SignOptions);
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, env.jwtRefreshSecret) as { sub: string };
}
