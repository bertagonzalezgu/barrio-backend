import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// La CLI (migrate, studio) usa la conexión directa: el pooler de Neon no soporta los
// advisory locks que usa `prisma migrate`. La app en ejecución usa DATABASE_URL (pooled).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
