import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';
import { hashToken, tokenMatchesHash } from '../lib/token-hash';

const BCRYPT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function toPublicUser(user: { id: string; name: string; email: string; role: Role }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function register(
  input: { name: string; email: string; password: string; role: Role },
  userAgent?: string | null,
) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash, role: input.role },
  });

  return { user: toPublicUser(user), tokens: await issueTokens(user.id, user.role, userAgent) };
}

export async function login(input: { email: string; password: string }, userAgent?: string | null) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return { user: toPublicUser(user), tokens: await issueTokens(user.id, user.role, userAgent) };
}

/**
 * Rotates the refresh token for one session, identified by the `sid` claim
 * embedded in the token itself. Every device/login gets its own Session
 * row, so refreshing or revoking one never touches another session's token.
 */
export async function refresh(refreshToken: string): Promise<AuthTokens> {
  let payload: { sub: string; sid: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.userId !== payload.sub || !tokenMatchesHash(refreshToken, session.refreshTokenHash)) {
    throw AppError.unauthorized('Refresh token no longer valid', 'INVALID_REFRESH_TOKEN');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) throw AppError.unauthorized('Refresh token no longer valid', 'INVALID_REFRESH_TOKEN');

  return rotateSession(session.id, user.id, user.role);
}

/** Deletes one session. Other sessions for the same user are untouched. */
export async function logout(userId: string, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId, userId } });
}

async function issueTokens(userId: string, role: Role, userAgent?: string | null): Promise<AuthTokens> {
  const sessionId = randomUUID();
  const accessToken = signAccessToken(userId, role, sessionId);
  const refreshToken = signRefreshToken(userId, sessionId);
  await prisma.session.create({
    data: { id: sessionId, userId, refreshTokenHash: hashToken(refreshToken), userAgent: userAgent ?? null },
  });
  return { accessToken, refreshToken };
}

async function rotateSession(sessionId: string, userId: string, role: Role): Promise<AuthTokens> {
  const accessToken = signAccessToken(userId, role, sessionId);
  const refreshToken = signRefreshToken(userId, sessionId);
  await prisma.session.update({
    where: { id: sessionId },
    data: { refreshTokenHash: hashToken(refreshToken), lastUsedAt: new Date() },
  });
  return { accessToken, refreshToken };
}
