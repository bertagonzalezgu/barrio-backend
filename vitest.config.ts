import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Los tests vacían las tablas después de cada caso: nunca deben tocar la base de desarrollo.
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
    // Todos los archivos comparten la misma base de datos de test: en paralelo se pisarían los datos.
    fileParallelism: false,
    // Neon suspende la base de test cuando está inactiva: la primera conexión puede tardar varios segundos.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
