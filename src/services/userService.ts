import { prisma } from '../config/prisma';
import { Prisma, type User } from '../generated/prisma/client';
import { grantWelcomeCredit } from './walletService';

interface RegisterUserInput {
  firebaseUid: string;
  email: string;
  name?: string;
}

type RegisterUserResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'missing-name' };

/**
 * Crea el usuario si no existe y le concede el regalo de bienvenida. Idempotente:
 * se puede llamar tras el registro y en cada login sin duplicar usuario ni horas.
 * `name` solo es necesario la primera vez, cuando se crea el usuario.
 */
export async function registerUser({ firebaseUid, email, name }: RegisterUserInput): Promise<RegisterUserResult> {
  let user = await prisma.user.findUnique({ where: { firebaseUid } });

  if (!user) {
    const trimmedName = name?.trim();
    if (!trimmedName) return { ok: false, reason: 'missing-name' };
    user = await createOrGetConcurrent(firebaseUid, email.trim().toLowerCase(), trimmedName);
  }

  // Se llama también con usuarios ya existentes: repara el caso de un usuario creado sin regalo.
  await grantWelcomeCredit(user.id);

  return { ok: true, user };
}

/**
 * Si dos peticiones de registro llegan a la vez, las dos ven "no existe" y las dos intentan crear.
 * El índice único de firebaseUid deja pasar solo una; la otra recibe P2002 y lee la fila ganadora.
 * (Un `upsert` con `update: {}` no lo evita: Prisma lo ejecuta como lectura + insert, no como ON CONFLICT.)
 */
async function createOrGetConcurrent(firebaseUid: string, email: string, name: string): Promise<User> {
  try {
    return await prisma.user.create({ data: { firebaseUid, email, name } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    // Si el conflicto era por el email (otra cuenta de Firebase con el mismo), no hay fila que recuperar.
    const existing = await prisma.user.findUnique({ where: { firebaseUid } });
    if (!existing) throw error;
    return existing;
  }
}

export async function getUserName(firebaseUid: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { name: true } });
  return user ? user.name : null;
}
