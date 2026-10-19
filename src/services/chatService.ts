import { prisma } from '../config/prisma';
import type { CardType, ExchangeStatus } from '../generated/prisma/client';
import {
  ACTIVE_STATUSES,
  findParticipation,
  findUserId,
  otherParty,
  PARTICIPANT_SELECT,
  type ExchangeFailure,
} from './exchangeService';
import { parseRequiredText } from './textInput';

export interface ChatMessage {
  id: string;
  text: string;
  sentAt: Date;
  mine: boolean;
}

type ChatFailure = { ok: false; reason: ExchangeFailure };

const MESSAGE_MAX_LENGTH = 2000;
const REPORT_REASON_MAX_LENGTH = 1000;

// Se escribe mientras el intercambio sigue vivo; cerrado (cancelled, rejected, confirmed, rated) queda solo en lectura.
const WRITABLE_STATUSES: ExchangeStatus[] = ACTIVE_STATUSES;

// El chat se puede leer en cualquier estado: también tiene que seguir disponible para revisar una denuncia.
export async function listMessages(
  firebaseUid: string,
  exchangeId: string,
): Promise<{ ok: true; messages: ChatMessage[] } | ChatFailure> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const messages = await prisma.message.findMany({
    where: { exchangeId },
    orderBy: { sentAt: 'asc' },
    select: { id: true, text: true, sentAt: true, senderId: true },
  });
  return {
    ok: true,
    messages: messages.map(({ senderId, ...message }) => ({ ...message, mine: senderId === participation.userId })),
  };
}

export type InvalidInput = { ok: false; reason: 'invalid'; error: string };

type SendMessageResult = { ok: true; message: ChatMessage } | ChatFailure | InvalidInput;

// Orden: no participas (404) antes que texto inválido (400) antes que chat cerrado (409),
// para que una tercera persona no pueda deducir nada del intercambio por la respuesta.
export async function sendMessage(firebaseUid: string, exchangeId: string, body: unknown): Promise<SendMessageResult> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const text = parseRequiredText(body, 'text', MESSAGE_MAX_LENGTH);
  if (!text.ok) return { ok: false, reason: 'invalid', error: text.error };

  return prisma.$transaction(async (tx) => {
    // FOR SHARE: un cambio de estado simultáneo espera a que se guarde el mensaje, o el mensaje ve ya el estado nuevo.
    // No bloquea otros mensajes del mismo chat, solo las escrituras sobre la fila del intercambio.
    const [{ status }] = await tx.$queryRaw<{ status: ExchangeStatus }[]>`
      SELECT status FROM "Exchange" WHERE id = ${exchangeId} FOR SHARE
    `;
    if (!WRITABLE_STATUSES.includes(status)) return { ok: false, reason: 'chat-closed' } as const;

    const message = await tx.message.create({
      data: { exchangeId, senderId: participation.userId, text: text.data },
      select: { id: true, text: true, sentAt: true },
    });
    return { ok: true, message: { ...message, mine: true } } as const;
  });
}

type ReportResult = { ok: true; report: { id: string; createdAt: Date } } | ChatFailure | InvalidInput;

// Se puede denunciar en cualquier estado y no cambia nada más: ni el intercambio, ni la card, ni el chat.
// cardId queda null a propósito: una denuncia de card oculta la card, y esta no debe confundirse con ella.
export async function reportConversation(firebaseUid: string, exchangeId: string, body: unknown): Promise<ReportResult> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const reason = parseRequiredText(body, 'reason', REPORT_REASON_MAX_LENGTH);
  if (!reason.ok) return { ok: false, reason: 'invalid', error: reason.error };

  const { userId, parties } = participation;
  const report = await prisma.report.create({
    data: {
      exchangeId,
      reporterId: userId,
      reportedUserId: otherParty(parties, userId),
      reason: reason.data,
    },
    // Respuesta mínima: ni el motivo ni nada de la persona denunciada.
    select: { id: true, createdAt: true },
  });
  return { ok: true, report };
}

export interface ChatSummary {
  id: string;
  status: ExchangeStatus;
  hours: number;
  proposedAt: Date;
  card: { id: string; title: string; type: CardType };
  other: { id: string; name: string; avatar: string };
  lastMessage: { text: string; sentAt: Date; mine: boolean } | null;
  lastActivityAt: Date;
}

interface LastMessageRow {
  exchangeId: string;
  text: string;
  sentAt: Date;
  senderId: string;
}

// Una sola consulta para el último mensaje de todos los intercambios. Prisma `distinct` traería todos los mensajes
// y deduplicaría en memoria; DISTINCT ON se queda con la primera fila por exchangeId en el propio Postgres, apoyándose
// en el índice [exchangeId, sentAt]. El id solo desempata dos mensajes del mismo milisegundo.
async function findLastMessages(exchangeIds: string[]): Promise<Map<string, LastMessageRow>> {
  if (exchangeIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<LastMessageRow[]>`
    SELECT DISTINCT ON ("exchangeId") "exchangeId", "text", "sentAt", "senderId"
    FROM "Message"
    WHERE "exchangeId" = ANY(${exchangeIds}::text[])
    ORDER BY "exchangeId", "sentAt" DESC, "id" DESC
  `;
  return new Map(rows.map((row) => [row.exchangeId, row]));
}

// Más reciente primero; con la misma actividad, por id para que el orden sea siempre el mismo.
// Comparación directa y no localeCompare, que depende del idioma y puede ignorar los guiones de los UUID.
function byLastActivity(a: ChatSummary, b: ChatSummary): number {
  const byActivity = b.lastActivityAt.getTime() - a.lastActivityAt.getTime();
  if (byActivity !== 0) return byActivity;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// La bandeja de chats: todos mis intercambios, en cualquier estado y aunque la card ya no esté activa.
// Se ordena en JS porque lastActivityAt combina dos tablas; si algún día hay paginación, el orden tendrá que ir a SQL.
export async function listMyChats(
  firebaseUid: string,
): Promise<{ ok: true; chats: ChatSummary[] } | { ok: false; reason: 'user-not-found' }> {
  const userId = await findUserId(firebaseUid);
  if (!userId) return { ok: false, reason: 'user-not-found' };

  const exchanges = await prisma.exchange.findMany({
    where: { OR: [{ proposerId: userId }, { receiverId: userId }] },
    select: {
      id: true,
      status: true,
      hours: true,
      proposedAt: true,
      updatedAt: true,
      proposerId: true,
      card: { select: { id: true, title: true, type: true } },
      proposer: { select: PARTICIPANT_SELECT },
      receiver: { select: PARTICIPANT_SELECT },
    },
  });
  const lastMessages = await findLastMessages(exchanges.map(({ id }) => id));

  const chats = exchanges.map(({ proposerId, proposer, receiver, updatedAt, ...exchange }): ChatSummary => {
    const last = lastMessages.get(exchange.id);
    // Enviar un mensaje no toca Exchange.updatedAt: la actividad es lo más reciente de las dos cosas.
    const lastActivityAt = last && last.sentAt > updatedAt ? last.sentAt : updatedAt;
    return {
      ...exchange,
      other: proposerId === userId ? receiver : proposer,
      lastMessage: last ? { text: last.text, sentAt: last.sentAt, mine: last.senderId === userId } : null,
      lastActivityAt,
    };
  });
  return { ok: true, chats: chats.sort(byLastActivity) };
}
