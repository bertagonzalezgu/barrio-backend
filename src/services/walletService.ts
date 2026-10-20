import { prisma } from '../config/prisma';
import { Prisma, type CardCategory, type CardType, type ExchangeStatus } from '../generated/prisma/client';

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
// Es la única fuente de la regla: payerOf la aplica a un intercambio concreto y paidBySql la convierte en filtro SQL.
const PAYER_ROLE = { offer: 'proposer', request: 'receiver' } as const satisfies Record<CardType, 'proposer' | 'receiver'>;

const PARTY_COLUMN = { proposer: Prisma.raw('e."proposerId"'), receiver: Prisma.raw('e."receiverId"') };

export function payerOf(cardType: CardType, exchange: { proposerId: string; receiverId: string }): string {
  return PAYER_ROLE[cardType] === 'proposer' ? exchange.proposerId : exchange.receiverId;
}

function paidBySql(userId: string): Prisma.Sql {
  const conditions = (Object.keys(PAYER_ROLE) as CardType[]).map(
    (type) => Prisma.sql`(c.type = ${type}::"CardType" AND ${PARTY_COLUMN[PAYER_ROLE[type]]} = ${userId})`,
  );
  return Prisma.join(conditions, ' OR ');
}

export async function getBalance(firebaseUid: string): Promise<Balance | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return null;
  return getBalanceByUserId(user.id);
}

// SUM de enteros en Postgres devuelve bigint: se pasa a number aquí y solo aquí. Las horas nunca rozan el límite.
interface BalanceRow {
  incoming: bigint;
  outgoing: bigint;
  reserved: bigint;
}

function toBalance(row: BalanceRow): Balance {
  const balance = Number(row.incoming) - Number(row.outgoing);
  const reserved = Number(row.reserved);
  return { balance, reserved, available: balance - reserved };
}

// Una sola sentencia para que las tres cifras salgan de la misma foto de la base de datos. Con consultas separadas,
// una confirmación (que a la vez crea la transferencia y deja de reservar) colada entre ellas inflaría el disponible.
// Acepta un cliente de transacción para que exchangeService pueda leer el saldo con las filas ya bloqueadas.
export async function getBalanceByUserId(userId: string, db: Prisma.TransactionClient = prisma): Promise<Balance> {
  const reservingStatuses = Prisma.join(RESERVING_STATUSES.map((status) => Prisma.sql`${status}::"ExchangeStatus"`));
  const [row] = await db.$queryRaw<BalanceRow[]>`
    SELECT
      (SELECT COALESCE(SUM(hours), 0) FROM "TimeTransaction" WHERE "toUserId" = ${userId} AND type = 'transfer') AS incoming,
      (SELECT COALESCE(SUM(hours), 0) FROM "TimeTransaction" WHERE "fromUserId" = ${userId} AND type = 'transfer') AS outgoing,
      (SELECT COALESCE(SUM(e.hours), 0)
         FROM "Exchange" e JOIN "Card" c ON c.id = e."cardId"
        WHERE e.status IN (${reservingStatuses}) AND (${paidBySql(userId)})) AS reserved
  `;
  return toBalance(row);
}

export interface TransactionItem {
  id: string;
  kind: 'welcome' | 'exchange';
  direction: 'in' | 'out';
  hours: number;
  date: Date;
  exchangeId: string | null;
  card: { id: string; title: string; type: CardType; category: CardCategory } | null;
  other: { id: string; name: string; avatar: string } | null;
}

// Sin paginación todavía: el tope evita respuestas sin límite. Se documenta como limitación del contrato.
const TRANSACTION_HISTORY_LIMIT = 100;

// Lo mismo que PARTICIPANT_SELECT de exchangeService; no se importa porque exchangeService ya depende de este módulo.
const OTHER_PARTY_SELECT = { id: true, name: true, avatar: true } as const;

// Una sola consulta: la otra persona y la card salen con join. hours va siempre en positivo; el signo es direction.
export async function getTransactions(firebaseUid: string): Promise<TransactionItem[] | null> {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!user) return null;

  const rows = await prisma.timeTransaction.findMany({
    where: { type: 'transfer', OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    take: TRANSACTION_HISTORY_LIMIT,
    select: {
      id: true,
      hours: true,
      date: true,
      exchangeId: true,
      toUserId: true,
      fromUser: { select: OTHER_PARTY_SELECT },
      toUser: { select: OTHER_PARTY_SELECT },
      exchange: { select: { card: { select: { id: true, title: true, type: true, category: true } } } },
    },
  });

  return rows.map(({ toUserId, fromUser, toUser, exchange, ...row }) => {
    const direction = toUserId === user.id ? 'in' : 'out';
    return {
      ...row,
      // Sin intercambio solo existe el regalo de bienvenida, que no viene de nadie.
      kind: row.exchangeId === null ? 'welcome' : 'exchange',
      direction,
      card: exchange?.card ?? null,
      other: direction === 'in' ? fromUser : toUser,
    };
  });
}
