import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test', override: true });

export default defineConfig({
  test: {
    env: process.env as Record<string, string>,
    testTimeout: 10_000,
    fileParallelism: false,
  },
});
