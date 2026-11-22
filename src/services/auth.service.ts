import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../lib/app-error';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt';

const BCRYPT_ROUNDS = 10;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function toPublicUser(user: { id: string; name: string; email: string; role: Role }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function register(input: { name: string; email: string; password: string; role: Role }) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, passwordHash, role: input.role },
  });

  return { user: toPublicUser(user), tokens: await issueTokens(user.id, user.role) };
}

export async function login(input: { email: string; password: string }) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return { user: toPublicUser(user), tokens: await issueTokens(user.id, user.role) };
}

export async function refresh(refreshToken: string): Promise<AuthTokens> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user?.refreshTokenHash || !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
    throw AppError.unauthorized('Refresh token no longer valid', 'INVALID_REFRESH_TOKEN');
  }

  return issueTokens(user.id, user.role);
}

export async function logout(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash: null } });
}

async function issueTokens(userId: string, role: Role): Promise<AuthTokens> {
  const accessToken = signAccessToken(userId, role);
  const refreshToken = signRefreshToken(userId);
  const refreshTokenHash = await bcrypt.hash(refreshToken, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { refreshTokenHash } });
  return { accessToken, refreshToken };
}
