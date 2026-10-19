import { prisma } from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import type { ParseResult } from './cardService';
import type { InvalidInput } from './chatService';
import {
  buildDetail,
  findParticipation,
  lockCard,
  otherParty,
  ratingBlocker,
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
  let result: { ok: true } | { ok: false; reason: ExchangeFailure };
  try {
    result = await prisma.$transaction(async (tx) => {
      // El mismo bloqueo que confirm: valorar y confirmar del mismo intercambio quedan en fila, y cada una lee
      // lo que dejó guardado la anterior. Es el único bloqueo, así que no hay orden que respetar ni interbloqueo posible.
      await lockCard(tx, parties.cardId);
      const { status } = await tx.exchange.findUniqueOrThrow({ where: { id: exchangeId }, select: { status: true } });
      const alreadyRated = (await tx.rating.count({ where: { exchangeId, raterId: userId } })) > 0;
      const blocker = ratingBlocker(status, alreadyRated);
      if (blocker) return { ok: false, reason: blocker } as const;

      await tx.rating.create({
        data: { exchangeId, raterId: userId, ratedUserId: otherParty(parties, userId), ...input.data },
      });
      // Solo hay dos participantes y cada una valora una vez: dos filas es que ya han valorado las dos.
      if ((await tx.rating.count({ where: { exchangeId } })) === 2) {
        await tx.exchange.update({ where: { id: exchangeId }, data: { status: 'rated', ratedAt: new Date() } });
      }
      return { ok: true } as const;
    });
  } catch (error) {
    // Red de seguridad del @@unique([exchangeId, raterId]). Se captura fuera: dentro, el error ya ha abortado la transacción.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'already-rated' };
    }
    throw error;
  }
  if (!result.ok) return result;

  return { ok: true, detail: await buildDetail(exchangeId, userId) };
}
