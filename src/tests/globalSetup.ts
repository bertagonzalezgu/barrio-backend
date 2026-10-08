import { execSync } from 'node:child_process';

export default function setup(): void {
  const directUrl = process.env.TEST_DATABASE_URL?.replace('-pooler', '');
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DIRECT_URL: directUrl },
    stdio: 'ignore',
  });
}
