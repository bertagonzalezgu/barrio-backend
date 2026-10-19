import { prisma } from '../config/prisma';
import type { ParseResult } from './cardService';
import type { InvalidInput } from './chatService';
import {
  buildDetail,
  findParticipation,
  lockCard,
  otherParty,
  type ExchangeDetail,
  type ExchangeFailure,
} from './exchangeService';
import { parseOptionalText } from './textInput';

const COMMENT_MAX_LENGTH = 500;

export interface RatingInput {
  score: number;
  comment: string | null;
}

export function parseRatingInput(body: unknown): ParseResult<RatingInput> {
  const score = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).score : undefined;
  // Sin conversiones: "4" y 2.5 se rechazan aunque se pudieran interpretar.
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return { ok: false, error: 'score es obligatorio y debe ser un entero entre 1 y 5' };
  }
  const comment = parseOptionalText(body, 'comment', COMMENT_MAX_LENGTH);
  if (!comment.ok) return comment;
  return { ok: true, data: { score, comment: comment.data } };
}

type RateResult = { ok: true; detail: ExchangeDetail } | { ok: false; reason: ExchangeFailure } | InvalidInput;

// Orden: no participas (404) antes que cuerpo inválido (400) antes que estado (409), como en el chat:
// una tercera persona no puede deducir nada del intercambio por la respuesta.
export async function rateExchange(firebaseUid: string, exchangeId: string, body: unknown): Promise<RateResult> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const input = parseRatingInput(body);
  if (!input.ok) return { ok: false, reason: 'invalid', error: input.error };

  const { userId, parties } = participation;
  await prisma.$transaction(async (tx) => {
    await lockCard(tx, parties.cardId);
    await tx.rating.create({
      data: { exchangeId, raterId: userId, ratedUserId: otherParty(parties, userId), ...input.data },
    });
  });

  return { ok: true, detail: await buildDetail(exchangeId, parties.receiverId === userId) };
}
