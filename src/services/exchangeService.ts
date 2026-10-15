import { prisma } from '../config/prisma';
import type { Exchange, ExchangeStatus, Prisma } from '../generated/prisma/client';
import type { ParseResult } from './cardService';
import { getBalanceByUserId, RESERVING_STATUSES } from './walletService';

type Tx = Prisma.TransactionClient;

export type ExchangeFailure = 'user-not-found' | 'card-not-found' | 'card-unavailable' | 'own-card' | 'already-proposed' | 'insufficient-balance';

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

// Una card queda cogida en cuanto tiene un intercambio que reserva horas: son los mismos estados que usa el saldo.
async function isCardTaken(db: Tx, cardId: string): Promise<boolean> {
  return (await db.exchange.count({ where: { cardId, status: { in: RESERVING_STATUSES } } })) > 0;
}

// Tras cancelled o rejected la propuesta deja de contar y se puede volver a proponer.
const ACTIVE_STATUSES: ExchangeStatus[] = ['proposed', ...RESERVING_STATUSES];

async function hasActiveProposal(db: Tx, cardId: string, proposerId: string): Promise<boolean> {
  return (await db.exchange.count({ where: { cardId, proposerId, status: { in: ACTIVE_STATUSES } } })) > 0;
}

async function canAfford(db: Tx, userId: string, hours: number): Promise<boolean> {
  return (await getBalanceByUserId(userId, db)).available >= hours;
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
    if (await isCardTaken(tx, card.id)) return fail('card-unavailable');
    if (await hasActiveProposal(tx, card.id, proposerId)) return fail('already-proposed');
    // En una card offer paga quien propone. Una propuesta no reserva nada, así que aquí no hace falta bloquear
    // a la pagadora: la comprobación que manda es la de accept. En una request paga la autora y se mira al aceptar.
    if (card.type === 'offer' && !(await canAfford(tx, proposerId, card.hours))) return fail('insufficient-balance');

    const exchange = await tx.exchange.create({
      data: { cardId: card.id, proposerId, receiverId: card.authorId, hours: card.hours },
    });
    return { ok: true, exchange };
  });
}

export interface CardExchangeState {
  mine: { id: string; status: ExchangeStatus } | null;
  cardAvailable: boolean;
}

type CardExchangeStateResult =
  | { ok: true; state: CardExchangeState }
  | { ok: false; reason: 'user-not-found' | 'card-not-found' };

// Para la autora `mine` siempre es null: no puede ser proponente de su propia card.
export async function getMyExchangeOnCard(firebaseUid: string, cardId: string): Promise<CardExchangeStateResult> {
  const userId = await findUserId(firebaseUid);
  if (!userId) return { ok: false, reason: 'user-not-found' };

  const card = await prisma.card.findUnique({ where: { id: cardId, status: { not: 'deleted' } }, select: { status: true } });
  if (!card) return { ok: false, reason: 'card-not-found' };

  const [mine, taken] = await Promise.all([
    prisma.exchange.findFirst({
      where: { cardId, proposerId: userId },
      orderBy: { proposedAt: 'desc' },
      select: { id: true, status: true },
    }),
    isCardTaken(prisma, cardId),
  ]);
  return { ok: true, state: { mine, cardAvailable: card.status === 'active' && !taken } };
}
