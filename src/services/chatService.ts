import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';
import type { ParseResult } from './cardService';
import { ACTIVE_STATUSES, findParticipation, type ExchangeFailure } from './exchangeService';

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

// Texto obligatorio, recortado; solo espacios cuenta como vacío.
function parseRequiredText(body: unknown, field: string, maxLength: number): ParseResult<string> {
  const value = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `${field} es obligatorio y debe ser un texto` };
  }
  if (value.trim().length > maxLength) {
    return { ok: false, error: `${field} debe tener ${maxLength} caracteres como máximo` };
  }
  return { ok: true, data: value.trim() };
}

type InvalidInput = { ok: false; reason: 'invalid'; error: string };

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
      reportedUserId: userId === parties.proposerId ? parties.receiverId : parties.proposerId,
      reason: reason.data,
    },
    // Respuesta mínima: ni el motivo ni nada de la persona denunciada.
    select: { id: true, createdAt: true },
  });
  return { ok: true, report };
}
