import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';

export const WELCOME_CREDIT_HOURS = 2;

const RESERVING_STATUSES: ExchangeStatus[] = ['accepted', 'done'];

export interface Balance {
  balance: number;
  reserved: number;
  available: number;
}

export async function grantWelcomeCredit(userId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { id: userId, welcomeCreditGrantedAt: null },
      data: { welcomeCreditGrantedAt: new Date() },
    });

    if (count === 0) {
      const exists = await tx.user.count({ where: { id: userId } });
      if (!exists) throw new Error(`No existe el usuario ${userId}`);
      return false;
    }

    await tx.timeTransaction.create({
      data: { type: 'transfer', toUserId: userId, hours: WELCOME_CREDIT_HOURS },
    });
    return true;
  });
}

export async function getBalance(firebaseUid: string): Promise<Balance | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return null;

  const [incoming, outgoing, reservedHours] = await Promise.all([
    prisma.timeTransaction.aggregate({ where: { toUserId: user.id, type: 'transfer' }, _sum: { hours: true } }),
    prisma.timeTransaction.aggregate({ where: { fromUserId: user.id, type: 'transfer' }, _sum: { hours: true } }),
    prisma.exchange.aggregate({
      where: { proposerId: user.id, status: { in: RESERVING_STATUSES } },
      _sum: { hours: true },
    }),
  ]);

  const balance = (incoming._sum.hours ?? 0) - (outgoing._sum.hours ?? 0);
  const reserved = reservedHours._sum.hours ?? 0;
  return { balance, reserved, available: balance - reserved };
}
