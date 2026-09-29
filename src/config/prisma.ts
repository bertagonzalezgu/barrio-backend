import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL no está definida. Añádela al archivo .env antes de arrancar.');
}

// Una única instancia para toda la app: cada PrismaClient abre su propio pool de conexiones.
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
