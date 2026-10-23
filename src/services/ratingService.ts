import { prisma } from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import { moderateContent } from './aiCardService';
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
import { toSkipTake, type Page, type Pagination } from './pagination';
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

export interface PublicRating {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  author: { name: string; avatar: string };
}

// "Carlos Pérez García" → "Carlos P.". Basta para reconocer a alguien sin publicar su nombre completo junto a su opinión.
export function abbreviateName(name: string): string {
  const [first, second] = name.trim().split(/\s+/);
  if (!second) return first;
  const [initial] = Array.from(second);
  return `${first} ${initial.toUpperCase()}.`;
}

// Sin id de autora: con él se llegaría a su perfil y al nombre completo, que es justo lo que se abrevia.
export async function listPublicRatings(ratedUserId: string, pagination: Pagination): Promise<Page<PublicRating>> {
  const where = { ratedUserId };
  const [ratings, total] = await Promise.all([
    prisma.rating.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        score: true,
        comment: true,
        commentModerated: true,
        createdAt: true,
        rater: { select: { name: true, avatar: true } },
      },
      ...toSkipTake(pagination),
    }),
    prisma.rating.count({ where }),
  ]);

  const items = ratings.map(({ commentModerated, comment, rater, ...rating }) => ({
    ...rating,
    // Los comentarios guardados cuando aún eran privados no pasaron moderación: no se publican.
    comment: commentModerated ? comment : null,
    author: { name: abbreviateName(rater.name), avatar: rater.avatar },
  }));
  return { items, total, ...pagination };
}

export type ModerationFailure =
  | { ok: false; reason: 'content-rejected'; message?: string }
  | { ok: false; reason: 'moderation-failed' };

type RateResult = { ok: true; detail: ExchangeDetail } | { ok: false; reason: ExchangeFailure } | InvalidInput | ModerationFailure;

async function moderateComment(comment: string): Promise<ModerationFailure | null> {
  try {
    const moderation = await moderateContent(comment);
    return moderation.seguro ? null : { ok: false, reason: 'content-rejected', message: moderation.message };
  } catch (error) {
    console.error('Fallo al moderar el comentario de la valoración:', error);
    return { ok: false, reason: 'moderation-failed' };
  }
}

async function currentBlocker(exchangeId: string, userId: string): Promise<ExchangeFailure | null> {
  const [{ status }, myRatings] = await Promise.all([
    prisma.exchange.findUniqueOrThrow({ where: { id: exchangeId }, select: { status: true } }),
    prisma.rating.count({ where: { exchangeId, raterId: userId } }),
  ]);
  return ratingBlocker(status, myRatings > 0);
}

// Orden: no participas (404) antes que cuerpo inválido (400) antes que estado (409) antes que moderación (422), como en el chat:
// una tercera persona no puede deducir nada del intercambio por la respuesta, y no se llama a la IA para algo que se iba a rechazar.
export async function rateExchange(firebaseUid: string, exchangeId: string, body: unknown): Promise<RateResult> {
  const participation = await findParticipation(firebaseUid, exchangeId);
  if (!participation.ok) return participation;

  const input = parseRatingInput(body);
  if (!input.ok) return { ok: false, reason: 'invalid', error: input.error };

  const { userId, parties } = participation;
  // Comprobación anticipada sin bloqueo, solo para no moderar en balde. La que decide es la de dentro de la transacción.
  const earlyBlocker = await currentBlocker(exchangeId, userId);
  if (earlyBlocker) return { ok: false, reason: earlyBlocker };

  const { comment } = input.data;
  if (comment !== null) {
    const rejected = await moderateComment(comment);
    if (rejected) return rejected;
  }

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
        data: {
          exchangeId,
          raterId: userId,
          ratedUserId: otherParty(parties, userId),
          ...input.data,
          // Llegados aquí el comentario, si lo hay, ya ha pasado moderación: se puede mostrar en el perfil público.
          commentModerated: comment !== null,
        },
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
