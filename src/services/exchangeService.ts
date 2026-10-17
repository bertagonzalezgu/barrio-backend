import { prisma } from '../config/prisma';
import type { CardStatus, CardType, Exchange, ExchangeStatus, Prisma } from '../generated/prisma/client';
import type { ParseResult } from './cardService';
import { getBalanceByUserId, payerOf, RESERVING_STATUSES } from './walletService';

type Tx = Prisma.TransactionClient;

export type ExchangeFailure =
  | 'user-not-found'
  | 'card-not-found'
  | 'card-unavailable'
  | 'own-card'
  | 'already-proposed'
  | 'insufficient-balance'
  | 'exchange-not-found'
  | 'forbidden'
  | 'invalid-transition';

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

// Se puede aceptar una propuesta sobre la card solo si sigue activa y nadie la tiene cogida.
async function isCardAvailable(db: Tx, card: { id: string; status: CardStatus }): Promise<boolean> {
  return card.status === 'active' && !(await isCardTaken(db, card.id));
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

  const card = await prisma.card.findUnique({
    where: { id: cardId, status: { not: 'deleted' } },
    select: { id: true, status: true },
  });
  if (!card) return { ok: false, reason: 'card-not-found' };

  const [mine, cardAvailable] = await Promise.all([
    prisma.exchange.findFirst({
      where: { cardId, proposerId: userId },
      orderBy: { proposedAt: 'desc' },
      select: { id: true, status: true },
    }),
    isCardAvailable(prisma, card),
  ]);
  return { ok: true, state: { mine, cardAvailable } };
}

interface TransitionRule {
  actor: 'receiver' | 'participant';
  from: ExchangeStatus[];
  data: () => Prisma.ExchangeUpdateInput;
}

const TRANSITIONS = {
  accept: { actor: 'receiver', from: ['proposed'], data: () => ({ status: 'accepted', acceptedAt: new Date() }) },
  reject: { actor: 'receiver', from: ['proposed'], data: () => ({ status: 'rejected', rejectedAt: new Date() }) },
  // done no se cancela aquí: a partir de ahí entra el flujo de confirmación de la tarjeta 13.
  cancel: {
    actor: 'participant',
    from: ['proposed', 'accepted'],
    data: () => ({ status: 'cancelled', cancelledAt: new Date() }),
  },
} satisfies Record<string, TransitionRule>;

export type ExchangeAction = keyof typeof TRANSITIONS;

const EXCHANGE_ACTIONS = Object.keys(TRANSITIONS) as ExchangeAction[];

function canAct(rule: TransitionRule, isReceiver: boolean): boolean {
  return rule.actor === 'participant' || isReceiver;
}

interface Parties {
  cardId: string;
  proposerId: string;
  receiverId: string;
}

export type ParticipationResult =
  | { ok: true; userId: string; parties: Parties }
  | { ok: false; reason: 'user-not-found' | 'exchange-not-found' };

// Participantes y card no cambian nunca, así que se pueden leer sin bloqueo antes de cualquier transacción.
export async function findParticipation(firebaseUid: string, exchangeId: string): Promise<ParticipationResult> {
  const userId = await findUserId(firebaseUid);
  if (!userId) return { ok: false, reason: 'user-not-found' };

  const parties = await prisma.exchange.findUnique({
    where: { id: exchangeId },
    select: { cardId: true, proposerId: true, receiverId: true },
  });
  // A quien no participa no le decimos que el intercambio existe.
  if (!parties || (parties.proposerId !== userId && parties.receiverId !== userId)) {
    return { ok: false, reason: 'exchange-not-found' };
  }
  return { ok: true, userId, parties };
}

// Mismo orden de bloqueo en todas las operaciones (card y después usuaria pagadora) para no provocar interbloqueos.
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

interface ExchangeToAccept {
  cardId: string;
  proposerId: string;
  receiverId: string;
  hours: number;
  card: { type: CardType; status: CardStatus };
}

// Bloquear a la pagadora serializa sus aceptaciones aunque sean de cards distintas: la segunda ve la reserva de la primera.
async function acceptBlocker(tx: Tx, exchange: ExchangeToAccept): Promise<ExchangeFailure | null> {
  if (!(await isCardAvailable(tx, { id: exchange.cardId, status: exchange.card.status }))) return 'card-unavailable';
  const payerId = payerOf(exchange.card.type, exchange);
  await lockUser(tx, payerId);
  return (await canAfford(tx, payerId, exchange.hours)) ? null : 'insufficient-balance';
}

// Fuera de la transacción solo se lee lo que no cambia (participantes y card) para saber qué card bloquear;
// el estado se vuelve a leer ya con el bloqueo puesto.
export async function transitionExchange(
  firebaseUid: string,
  exchangeId: string,
  action: ExchangeAction,
): Promise<ExchangeResult> {
  const rule: TransitionRule = TRANSITIONS[action];
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;
  const { userId, parties } = participation;
  if (!canAct(rule, parties.receiverId === userId)) return fail('forbidden');

  return prisma.$transaction(async (tx) => {
    await lockCard(tx, parties.cardId);
    const exchange = await tx.exchange.findUniqueOrThrow({
      where: { id: exchangeId },
      include: { card: { select: { type: true, status: true } } },
    });
    if (!rule.from.includes(exchange.status)) return fail('invalid-transition');

    if (action === 'accept') {
      const blocker = await acceptBlocker(tx, exchange);
      if (blocker) return fail(blocker);
    }

    const updated = await tx.exchange.update({ where: { id: exchangeId }, data: rule.data() });
    return { ok: true, exchange: updated };
  });
}

// Select explícito: de la otra persona solo sale lo que el chat necesita pintar, nunca su email.
const PARTICIPANT_SELECT = { id: true, name: true, avatar: true } as const;

export interface ExchangeDetail {
  id: string;
  status: ExchangeStatus;
  hours: number;
  card: { id: string; title: string; type: CardType };
  other: { id: string; name: string; avatar: string };
  myConfirmed: boolean;
  otherConfirmed: boolean;
  actions: ExchangeAction[];
}

type ExchangeDetailResult = { ok: true; detail: ExchangeDetail } | { ok: false; reason: ExchangeFailure };

// Las acciones salen de la misma tabla TRANSITIONS que aplica transitionExchange, para que el frontend no repita reglas.
// accept solo se ofrece si de verdad podría salir bien: la card sigue libre. El saldo se comprueba al aceptar.
async function availableActions(
  status: ExchangeStatus,
  isReceiver: boolean,
  card: { id: string; status: CardStatus },
): Promise<ExchangeAction[]> {
  const actions = EXCHANGE_ACTIONS.filter((action) => {
    const rule: TransitionRule = TRANSITIONS[action];
    return rule.from.includes(status) && canAct(rule, isReceiver);
  });
  if (actions.includes('accept') && !(await isCardAvailable(prisma, card))) {
    return actions.filter((action) => action !== 'accept');
  }
  return actions;
}

export async function getExchangeDetail(firebaseUid: string, exchangeId: string): Promise<ExchangeDetailResult> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;
  const isReceiver = participation.parties.receiverId === participation.userId;

  const exchange = await prisma.exchange.findUniqueOrThrow({
    where: { id: exchangeId },
    select: {
      id: true,
      status: true,
      hours: true,
      proposerConfirmedAt: true,
      receiverConfirmedAt: true,
      card: { select: { id: true, title: true, type: true, status: true } },
      proposer: { select: PARTICIPANT_SELECT },
      receiver: { select: PARTICIPANT_SELECT },
    },
  });

  const { status: cardStatus, ...card } = exchange.card;
  const [myConfirmedAt, otherConfirmedAt] = isReceiver
    ? [exchange.receiverConfirmedAt, exchange.proposerConfirmedAt]
    : [exchange.proposerConfirmedAt, exchange.receiverConfirmedAt];

  return {
    ok: true,
    detail: {
      id: exchange.id,
      status: exchange.status,
      hours: exchange.hours,
      card,
      other: isReceiver ? exchange.proposer : exchange.receiver,
      myConfirmed: myConfirmedAt !== null,
      otherConfirmed: otherConfirmedAt !== null,
      actions: await availableActions(exchange.status, isReceiver, { id: card.id, status: cardStatus }),
    },
  };
}
