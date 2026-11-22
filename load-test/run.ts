import 'dotenv/config';
import { spawn, ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import autocannon from 'autocannon';
import { PrismaClient, Role } from '@prisma/client';
import jwt from 'jsonwebtoken';

/**
 * Stress harness for POST /api/bookings — the assignment's required
 * performance scenario ("how many users can it handle simultaneously for
 * booking an event").
 *
 * mode=baseline  -> small Prisma connection pool (connection_limit=5), the
 *                   kind of default a first pass ships with, so the DB
 *                   connection pool becomes the bottleneck under load.
 * mode=optimized -> properly sized pool (connection_limit=20) + the indexes
 *                   already in prisma/schema.prisma (Event.organizerId,
 *                   Event.date, Booking.userId/eventId/[eventId,status]).
 *
 * Both runs hit the same code path; only DATABASE_URL's pool params differ.
 * This isolates the lever we're demonstrating rather than conflating it
 * with a hand-wavy "before/after" rewrite.
 */

const mode = process.argv[2];
if (mode !== 'baseline' && mode !== 'optimized') {
  console.error('Usage: tsx load-test/run.ts <baseline|optimized>');
  process.exit(1);
}

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;
const POOL = mode === 'baseline' ? 5 : 20;
const STEPS = [10, 25, 50, 100, 200, 400, 800, 1200];

function withPool(databaseUrl: string, poolSize: number): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('connection_limit', String(poolSize));
  url.searchParams.set('pool_timeout', '5');
  return url.toString();
}

async function waitForHealth(timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not become healthy in time');
}

function startServer(databaseUrl: string): ChildProcess {
  return spawn('npx', ['tsx', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL: databaseUrl,
      NODE_ENV: 'production', // quiets per-request logging noise during the run
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const MAX_CONNECTIONS = Math.max(...STEPS);

async function seedEventAndTokens(databaseUrl: string): Promise<{ eventId: string; tokens: string[] }> {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const organizer = await prisma.user.create({
    data: {
      name: 'Load Test Organizer',
      email: `loadtest-organizer-${Date.now()}@example.com`,
      passwordHash: 'unused',
      role: Role.ORGANIZER,
    },
  });
  const event = await prisma.event.create({
    data: {
      title: 'Load Test Event',
      description: 'Hot event used for the booking stress scenario',
      date: new Date(Date.now() + 86_400_000),
      location: 'Load Test Arena',
      totalTickets: 10_000_000,
      availableTickets: 10_000_000,
      priceCents: 1000,
      organizerId: organizer.id,
    },
  });

  // One distinct customer per concurrent connection, so the booking
  // rate-limiter (keyed per-user) reflects "N different customers booking
  // at once" rather than one account hammering the endpoint.
  const runTag = Date.now();
  await prisma.user.createMany({
    data: Array.from({ length: MAX_CONNECTIONS }, (_, i) => ({
      name: `Load Test Customer ${i}`,
      email: `loadtest-customer-${runTag}-${i}@example.com`,
      passwordHash: 'unused',
      role: Role.CUSTOMER,
    })),
  });
  const customers = await prisma.user.findMany({
    where: { email: { startsWith: `loadtest-customer-${runTag}-` } },
  });

  const tokens = customers.map((c) =>
    jwt.sign({ sub: c.id, role: 'CUSTOMER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '1h' }),
  );

  await prisma.$disconnect();
  return { eventId: event.id, tokens };
}

interface StepResult {
  connections: number;
  requestsPerSec: number;
  latencyP50: number;
  latencyP99: number;
  errors: number;
  timeouts: number;
  non2xx: number;
}

async function runStep(connections: number, eventId: string, tokens: string[]): Promise<StepResult> {
  // One request per connection (amount === connections): models "N distinct
  // customers all hitting Book Now on the same event at once", which is
  // literally what the assignment asks us to find the breaking point of —
  // not a sustained-throughput benchmark with one hammering client.
  let tokenIndex = 0;
  const result = await autocannon({
    url: `${BASE_URL}/api/bookings`,
    method: 'POST',
    connections,
    amount: connections,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventId, ticketsCount: 1 }),
    setupClient: (client) => {
      const token = tokens[tokenIndex % tokens.length];
      tokenIndex += 1;
      client.setHeaders({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
    },
  });

  const non2xx = Object.entries(result.statusCodeStats ?? {}).reduce(
    (sum, [code, stat]) => (Number(code) >= 300 ? sum + (stat as { count: number }).count : sum),
    0,
  );

  return {
    connections,
    requestsPerSec: result.requests.average,
    latencyP50: result.latency.p50,
    latencyP99: result.latency.p99,
    errors: result.errors,
    timeouts: result.timeouts,
    non2xx,
  };
}

async function main() {
  const databaseUrl = withPool(process.env.DATABASE_URL!, POOL);
  console.log(`\n=== Load test: ${mode} (connection_limit=${POOL}) ===\n`);

  const { eventId, tokens } = await seedEventAndTokens(databaseUrl);

  const server = startServer(databaseUrl);
  server.stdout?.on('data', () => {});
  server.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForHealth();

    const results: StepResult[] = [];
    for (const connections of STEPS) {
      console.log(`-- concurrency ${connections} --`);
      const stepResult = await runStep(connections, eventId, tokens);
      results.push(stepResult);
      console.log(
        `  req/s=${stepResult.requestsPerSec.toFixed(0)}  p50=${stepResult.latencyP50}ms  p99=${stepResult.latencyP99}ms  non-2xx=${stepResult.non2xx}  timeouts=${stepResult.timeouts}`,
      );
    }

    mkdirSync('load-test/results', { recursive: true });
    const outPath = `load-test/results/${mode}.json`;
    writeFileSync(outPath, JSON.stringify({ mode, pool: POOL, steps: STEPS, results }, null, 2));
    console.log(`\nResults written to ${outPath}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
