import { prisma } from '../config/prisma';
import { Prisma, type ExchangeStatus, type User } from '../generated/prisma/client';
import { findUserId } from './exchangeService';
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

export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  verified: boolean;
  ratingAverage: number | null;
  ratingCount: number;
  exchangeCount: number;
  createdAt: Date;
}

type PublicProfileResult = { ok: true; profile: PublicProfile } | { ok: false; reason: 'user-not-found' | 'profile-not-found' };

// Intercambios que llegaron a completarse: las dos personas confirmaron, hayan valorado o no.
const COMPLETED_STATUSES: ExchangeStatus[] = ['confirmed', 'rated'];

// Select explícito: del perfil de otra persona nunca sale su email, su firebaseUid ni nada del wallet.
const PUBLIC_PROFILE_SELECT = { id: true, name: true, avatar: true, verified: true, registeredAt: true } as const;

export async function getPublicProfile(firebaseUid: string, userId: string): Promise<PublicProfileResult> {
  if (!(await findUserId(firebaseUid))) return { ok: false, reason: 'user-not-found' };

  const profile = await buildProfile(userId);
  return profile ? { ok: true, profile } : { ok: false, reason: 'profile-not-found' };
}

// La media no se guarda: se calcula al leer, igual que el saldo sale de TimeTransaction.
// Así nunca puede quedar desfasada respecto a las valoraciones que hay de verdad.
async function buildProfile(userId: string): Promise<PublicProfile | null> {
  const found = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_PROFILE_SELECT });
  if (!found) return null;
  // En la API se llama createdAt, como en el resto de recursos; la columna es registeredAt.
  const { registeredAt, ...user } = found;

  const [ratings, exchangeCount] = await Promise.all([
    prisma.rating.aggregate({ where: { ratedUserId: userId }, _avg: { score: true }, _count: true }),
    prisma.exchange.count({
      where: { status: { in: COMPLETED_STATUSES }, OR: [{ proposerId: userId }, { receiverId: userId }] },
    }),
  ]);
  const average = ratings._avg.score;

  return {
    ...user,
    // Sin valoraciones es null y no 0: un 0 se leería como "la peor nota".
    ratingAverage: average === null ? null : Math.round(average * 10) / 10,
    ratingCount: ratings._count,
    exchangeCount,
    createdAt: registeredAt,
  };
}

// Mi perfil tiene la misma forma que el que ven las demás: el frontend usa un solo tipo para los dos.
export async function getOwnProfile(firebaseUid: string): Promise<PublicProfile | null> {
  const userId = await findUserId(firebaseUid);
  return userId ? buildProfile(userId) : null;
}
