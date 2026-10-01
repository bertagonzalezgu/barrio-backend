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

export async function registerUser({ firebaseUid, email, name }: RegisterUserInput): Promise<RegisterUserResult> {
  let user = await prisma.user.findUnique({ where: { firebaseUid } });

  if (!user) {
    const trimmedName = name?.trim();
    if (!trimmedName) return { ok: false, reason: 'missing-name' };
    user = await createOrGetConcurrent(firebaseUid, email.trim().toLowerCase(), trimmedName);
  }

  await grantWelcomeCredit(user.id);

  return { ok: true, user };
}

async function createOrGetConcurrent(firebaseUid: string, email: string, name: string): Promise<User> {
  try {
    return await prisma.user.create({ data: { firebaseUid, email, name } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await prisma.user.findUnique({ where: { firebaseUid } });
    if (!existing) throw error;
    return existing;
  }
}

export async function getUserName(firebaseUid: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { name: true } });
  return user ? user.name : null;
}
