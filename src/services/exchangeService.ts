import { prisma } from '../config/prisma';
import type { Exchange, Prisma } from '../generated/prisma/client';
import type { ParseResult } from './cardService';

type Tx = Prisma.TransactionClient;

export type ExchangeFailure = 'user-not-found' | 'card-not-found' | 'card-unavailable' | 'own-card';

type ExchangeResult = { ok: true; exchange: Exchange } | { ok: false; reason: ExchangeFailure };

export interface CreateExchangeInput {
  cardId: string;
}

function fail(reason: ExchangeFailure): { ok: false; reason: ExchangeFailure } {
  return { ok: false, reason };
}

export function parseCreateExchangeInput(body: unknown): ParseResult<CreateExchangeInput> {
  const cardId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).cardId : undefined;
  if (typeof cardId !== 'string' || cardId.trim() === '') {
    return { ok: false, error: 'cardId es obligatorio y debe ser un texto' };
  }
  return { ok: true, data: { cardId } };
}

async function findUserId(firebaseUid: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  return user?.id ?? null;
}

// Bloquea la fila hasta el final de la transacción: cualquier otra operación sobre la misma card espera su turno,
// y al continuar lee el estado ya confirmado por la anterior (READ COMMITTED toma una foto nueva por consulta).
async function lockCard(tx: Tx, cardId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Card" WHERE id = ${cardId} FOR UPDATE`;
}

export async function createExchange(firebaseUid: string, { cardId }: CreateExchangeInput): Promise<ExchangeResult> {
  const proposerId = await findUserId(firebaseUid);
  if (!proposerId) return fail('user-not-found');

  return prisma.$transaction(async (tx) => {
    await lockCard(tx, cardId);
    const card = await tx.card.findUnique({ where: { id: cardId, status: { not: 'deleted' } } });
    if (!card) return fail('card-not-found');
    if (card.status !== 'active') return fail('card-unavailable');
    if (card.authorId === proposerId) return fail('own-card');

    const exchange = await tx.exchange.create({
      data: { cardId: card.id, proposerId, receiverId: card.authorId, hours: card.hours },
    });
    return { ok: true, exchange };
  });
}
