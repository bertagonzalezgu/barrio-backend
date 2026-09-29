import { execSync } from 'node:child_process';

// Aplica las migraciones pendientes a la base de test antes de toda la suite.
// `migrate` necesita la conexión directa; en Neon es la misma URL sin el sufijo `-pooler` del host.
export default function setup(): void {
  const directUrl = process.env.TEST_DATABASE_URL?.replace('-pooler', '');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DIRECT_URL: directUrl },
    stdio: 'ignore',
  });
}
