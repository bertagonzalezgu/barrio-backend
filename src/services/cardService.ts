import { prisma } from '../config/prisma';
import { CardCategory, CardType, type Card } from '../generated/prisma/client';

export interface CreateCardInput {
  type: CardType;
  title: string;
  description: string;
  category: CardCategory;
  hours: number;
  icon?: string;
  lat?: number;
  lng?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface CardFilters {
  type?: CardType;
  category?: CardCategory;
}

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

type CreateCardResult = { ok: true; card: Card } | { ok: false; reason: 'user-not-found' };

// La autora que ve el frontend: firebaseUid para saber si es la dueña, id/name/email para pintar el perfil.
const AUTHOR_SELECT = { id: true, name: true, email: true, firebaseUid: true } as const;

export const CARD_TYPES = Object.values(CardType);
export const CARD_CATEGORIES = Object.values(CardCategory);

export function isCardType(value: unknown): value is CardType {
  return CARD_TYPES.includes(value as CardType);
}

export function isCardCategory(value: unknown): value is CardCategory {
  return CARD_CATEGORIES.includes(value as CardCategory);
}

export function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function parseOptionalNumber(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Solo fechas de calendario (YYYY-MM-DD): de un instante con hora no se puede saber qué día eligió la persona
// sin su zona horaria, así que lo rechazamos en vez de adivinar.
function parseOptionalDateOnly(value: unknown): Date | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  // El round-trip descarta días que no existen, como 2026-02-30.
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? date : null;
}

interface Schedule {
  startDate: Date | null;
  endDate: Date | null;
}

interface ScheduleChange {
  startDate?: Date;
  durationDays?: number;
}

function parseScheduleChange(input: Record<string, unknown>): ParseResult<ScheduleChange> {
  if (input.endDate !== undefined) {
    return { ok: false, error: 'La fecha de fin se calcula en el servidor: envía durationDays' };
  }

  const startDate = parseOptionalDateOnly(input.startDate);
  if (startDate === null) return { ok: false, error: 'La fecha de inicio debe tener formato YYYY-MM-DD' };

  const { durationDays } = input;
  if (durationDays !== undefined && (typeof durationDays !== 'number' || !Number.isInteger(durationDays) || durationDays < 1)) {
    return { ok: false, error: 'La duración debe ser un número entero de días mayor que 0' };
  }

  return { ok: true, data: { startDate, durationDays } };
}

// Inclusivo: 5 días empezando el día 1 terminan el día 5. En UTC no hay cambios de hora, así que sumar ms es exacto.
function computeEndDate(startDate: Date, durationDays: number): Date {
  return new Date(startDate.getTime() + (durationDays - 1) * MS_PER_DAY);
}

// Aplica un cambio de fechas sobre las actuales. Mantiene la invariante: startDate y endDate van las dos o ninguna.
function resolveSchedule(
  current: Schedule,
  change: ScheduleChange,
): ParseResult<{ startDate?: Date; endDate?: Date }> {
  const { startDate, durationDays } = change;
  if (startDate === undefined && durationDays === undefined) return { ok: true, data: {} };

  const start = startDate ?? current.startDate;
  if (!start) return { ok: false, error: 'La duración necesita una fecha de inicio' };

  const days =
    durationDays ??
    (current.startDate && current.endDate
      ? Math.round((current.endDate.getTime() - current.startDate.getTime()) / MS_PER_DAY) + 1
      : undefined);
  if (days === undefined) return { ok: false, error: 'Indica la duración en días junto con la fecha de inicio' };

  return { ok: true, data: { startDate: start, endDate: computeEndDate(start, days) } };
}

export function parseCreateCardInput(body: unknown): ParseResult<CreateCardInput> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { type, title, description, category, hours, icon } = input;

  if (isMissing(category)) return { ok: false, error: 'La categoría es obligatoria' };
  if (!isCardCategory(category)) return { ok: false, error: `La categoría debe ser una de: ${CARD_CATEGORIES.join(', ')}` };

  if (isMissing(description)) return { ok: false, error: 'La descripción es obligatoria' };
  if (typeof description !== 'string' || description.trim().length > 1000) {
    return { ok: false, error: 'La descripción debe ser un texto de 1000 caracteres como máximo' };
  }

  if (isMissing(type)) return { ok: false, error: 'El tipo es obligatorio' };
  if (!isCardType(type)) return { ok: false, error: `El tipo debe ser uno de: ${CARD_TYPES.join(', ')}` };

  if (isMissing(title)) return { ok: false, error: 'El título es obligatorio' };
  if (typeof title !== 'string' || title.trim().length > 120) {
    return { ok: false, error: 'El título debe ser un texto de 120 caracteres como máximo' };
  }

  if (isMissing(hours)) return { ok: false, error: 'Las horas son obligatorias' };
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1) {
    return { ok: false, error: 'Las horas deben ser un número entero mayor que 0' };
  }

  if (icon !== undefined && typeof icon !== 'string') return { ok: false, error: 'El icono debe ser un texto' };

  const lat = parseOptionalNumber(input.lat, -90, 90);
  const lng = parseOptionalNumber(input.lng, -180, 180);
  if (lat === null || lng === null) return { ok: false, error: 'La ubicación (lat, lng) no es válida' };
  // Una coordenada sin la otra no sirve para pintar el pin en el mapa.
  if ((lat === undefined) !== (lng === undefined)) {
    return { ok: false, error: 'La ubicación necesita lat y lng a la vez' };
  }

  const scheduleChange = parseScheduleChange(input);
  if (!scheduleChange.ok) return scheduleChange;
  const schedule = resolveSchedule({ startDate: null, endDate: null }, scheduleChange.data);
  if (!schedule.ok) return schedule;
  const { startDate, endDate } = schedule.data;

  return {
    ok: true,
    data: {
      type,
      title: title.trim(),
      description: description.trim(),
      category,
      hours,
      icon,
      lat,
      lng,
      startDate,
      endDate,
    },
  };
}

export function parseCardFilters(query: Record<string, unknown>): ParseResult<CardFilters> {
  const { type, category } = query;

  if (type !== undefined && !isCardType(type)) {
    return { ok: false, error: `El tipo debe ser uno de: ${CARD_TYPES.join(', ')}` };
  }
  if (category !== undefined && !isCardCategory(category)) {
    return { ok: false, error: `La categoría debe ser una de: ${CARD_CATEGORIES.join(', ')}` };
  }

  return { ok: true, data: { type, category } };
}

export async function createCard(firebaseUid: string, input: CreateCardInput): Promise<CreateCardResult> {
  const author = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true } });
  if (!author) return { ok: false, reason: 'user-not-found' };

  const card = await prisma.card.create({ data: { ...input, authorId: author.id, status: 'active' } });
  return { ok: true, card };
}

export async function listActiveCards(filters: CardFilters) {
  return prisma.card.findMany({
    where: { status: 'active', ...filters },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

export async function findCardById(id: string) {
  return prisma.card.findUnique({
    where: { id, status: { not: 'deleted' } },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

type DeleteCardResult = { ok: true } | { ok: false; reason: 'not-found' | 'forbidden' };

// Borrado lógico: los Exchange y Report que apuntan a la card siguen intactos, y con ellos el historial de horas.
export async function deleteCard(id: string, firebaseUid: string): Promise<DeleteCardResult> {
  const card = await prisma.card.findUnique({
    where: { id, status: { not: 'deleted' } },
    select: { author: { select: { firebaseUid: true } } },
  });
  if (!card) return { ok: false, reason: 'not-found' };
  // authorId es el id interno del User, no el uid de Firebase: hay que comparar con author.firebaseUid.
  if (card.author.firebaseUid !== firebaseUid) return { ok: false, reason: 'forbidden' };

  await prisma.card.update({ where: { id }, data: { status: 'deleted' } });
  return { ok: true };
}
