import { prisma } from '../config/prisma';

afterEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const tableList = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
