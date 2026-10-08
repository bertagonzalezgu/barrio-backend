import 'dotenv/config';
import { defineConfig } from 'vitest/config';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error('TEST_DATABASE_URL no está definida. Los tests necesitan una base de datos propia.');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: { DATABASE_URL: testDatabaseUrl },
    globalSetup: ['./src/tests/globalSetup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
