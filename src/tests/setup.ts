import { prisma } from '../config/prisma';

afterEach(async () => {
  // Se leen las tablas del esquema en vez de listarlas a mano, así los modelos nuevos se limpian solos.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  // Unsafe porque los nombres de tabla no se pueden pasar como parámetro; vienen de pg_tables, no de la usuaria.
  const tableList = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} CASCADE`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
