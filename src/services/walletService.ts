import { prisma } from '../config/prisma';
import type { CardType, ExchangeStatus, Prisma } from '../generated/prisma/client';

export const WELCOME_CREDIT_HOURS = 2;

export const RESERVING_STATUSES: ExchangeStatus[] = ['accepted', 'done'];

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

// Paga quien recibe la ayuda: en una card offer es quien propone, en una request es la autora (receptora).
// payerOf y paidBy expresan la misma regla, una para un intercambio concreto y otra como filtro de consulta.
export function payerOf(cardType: CardType, exchange: { proposerId: string; receiverId: string }): string {
  return cardType === 'offer' ? exchange.proposerId : exchange.receiverId;
}

function paidBy(userId: string): Prisma.ExchangeWhereInput {
  return {
    OR: [
      { proposerId: userId, card: { type: 'offer' } },
      { receiverId: userId, card: { type: 'request' } },
    ],
  };
}

export async function getBalance(firebaseUid: string): Promise<Balance | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return null;
  return getBalanceByUserId(user.id);
}

// Acepta un cliente de transacción para que exchangeService pueda leer el saldo con las filas ya bloqueadas.
export async function getBalanceByUserId(userId: string, db: Prisma.TransactionClient = prisma): Promise<Balance> {
  const [incoming, outgoing, reservedHours] = await Promise.all([
    db.timeTransaction.aggregate({ where: { toUserId: userId, type: 'transfer' }, _sum: { hours: true } }),
    db.timeTransaction.aggregate({ where: { fromUserId: userId, type: 'transfer' }, _sum: { hours: true } }),
    db.exchange.aggregate({
      where: { ...paidBy(userId), status: { in: RESERVING_STATUSES } },
      _sum: { hours: true },
    }),
  ]);

  const balance = (incoming._sum.hours ?? 0) - (outgoing._sum.hours ?? 0);
  const reserved = reservedHours._sum.hours ?? 0;
  return { balance, reserved, available: balance - reserved };
}
