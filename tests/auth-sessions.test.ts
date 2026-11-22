import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as authService from '../src/services/auth.service';
import { prisma } from '../src/lib/prisma';
import { resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

async function register(email: string) {
  return authService.register({ name: 'Multi Device', email, password: 'password123', role: 'CUSTOMER' });
}

describe('multi-device sessions', () => {
  it('lets two independent sessions for the same user both refresh', async () => {
    const email = `two-devices-${Date.now()}@example.com`;
    const deviceA = await register(email);
    const deviceB = await authService.login({ email, password: 'password123' });

    // Logging in on device B must not break device A's already-issued refresh token.
    const refreshedA = await authService.refresh(deviceA.tokens.refreshToken);
    const refreshedB = await authService.refresh(deviceB.tokens.refreshToken);

    expect(refreshedA.accessToken).toBeTruthy();
    expect(refreshedB.accessToken).toBeTruthy();
  });

  it("logging out of one session doesn't invalidate the other", async () => {
    const email = `logout-one-${Date.now()}@example.com`;
    const deviceA = await register(email);
    const deviceB = await authService.login({ email, password: 'password123' });

    const { sub: userId, sid: sessionIdA } = decodeRefresh(deviceA.tokens.refreshToken);
    await authService.logout(userId, sessionIdA);

    await expect(authService.refresh(deviceA.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    await expect(authService.refresh(deviceB.tokens.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('rotates only the refreshed session, leaving the old token for that session dead', async () => {
    const email = `rotate-${Date.now()}@example.com`;
    const deviceA = await register(email);
    const deviceB = await authService.login({ email, password: 'password123' });

    const rotatedA = await authService.refresh(deviceA.tokens.refreshToken);

    // The old device-A refresh token must no longer work (rotation).
    await expect(authService.refresh(deviceA.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
    // The new device-A refresh token works.
    await expect(authService.refresh(rotatedA.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
    // Device B was never touched by rotating device A.
    await expect(authService.refresh(deviceB.tokens.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it('rejects a refresh token whose session was deleted', async () => {
    const email = `deleted-session-${Date.now()}@example.com`;
    const device = await register(email);
    const { sub: userId, sid: sessionId } = decodeRefresh(device.tokens.refreshToken);

    await authService.logout(userId, sessionId);

    await expect(authService.refresh(device.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 });
  });
});

function decodeRefresh(token: string): { sub: string; sid: string } {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return { sub: payload.sub, sid: payload.sid };
}
