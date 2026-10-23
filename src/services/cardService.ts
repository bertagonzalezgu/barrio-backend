import { prisma } from '../config/prisma';
import { CardCategory, CardType, type Card, type Prisma } from '../generated/prisma/client';
import { toApproximateCoordinates, type Coordinates } from './coordinates';
import { toSkipTake, type Pagination } from './pagination';

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

// firebaseUid solo se lee para calcular isMine: toCardResponse lo quita antes de responder.
const AUTHOR_SELECT = { id: true, name: true, avatar: true, firebaseUid: true } as const;

type CardWithAuthor = Prisma.CardGetPayload<{ include: { author: { select: typeof AUTHOR_SELECT } } }>;

export type CardResponse = Card & { author: { id: string; name: string; avatar: string }; isMine: boolean };

// Única forma en que una card sale del servidor: de la autora, solo lo que se pinta; nunca su email ni su firebaseUid.
// La ubicación exacta solo la ve la autora; el resto recibe la misma celda aproximada que el mapa.
export function toCardResponse({ author: { firebaseUid: authorUid, ...author }, ...card }: CardWithAuthor, firebaseUid: string): CardResponse {
  const isMine = authorUid === firebaseUid;
  const location = isMine || card.lat === null || card.lng === null ? {} : toApproximateCoordinates(card.lat, card.lng);
  return { ...card, ...location, author, isMine };
}

type CreateCardResult = { ok: true; card: CardWithAuthor } | { ok: false; reason: 'user-not-found' };

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

function toRecord(body: unknown): Record<string, unknown> {
  return (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
}

// Validadores por campo, compartidos por create (campos obligatorios) y update (solo los que llegan).
function parseCategory(value: unknown): ParseResult<CardCategory> {
  if (isMissing(value)) return { ok: false, error: 'La categoría es obligatoria' };
  if (!isCardCategory(value)) return { ok: false, error: `La categoría debe ser una de: ${CARD_CATEGORIES.join(', ')}` };
  return { ok: true, data: value };
}

function parseDescription(value: unknown): ParseResult<string> {
  if (isMissing(value)) return { ok: false, error: 'La descripción es obligatoria' };
  if (typeof value !== 'string' || value.trim().length > 1000) {
    return { ok: false, error: 'La descripción debe ser un texto de 1000 caracteres como máximo' };
  }
  return { ok: true, data: value.trim() };
}

function parseType(value: unknown): ParseResult<CardType> {
  if (isMissing(value)) return { ok: false, error: 'El tipo es obligatorio' };
  if (!isCardType(value)) return { ok: false, error: `El tipo debe ser uno de: ${CARD_TYPES.join(', ')}` };
  return { ok: true, data: value };
}

function parseTitle(value: unknown): ParseResult<string> {
  if (isMissing(value)) return { ok: false, error: 'El título es obligatorio' };
  if (typeof value !== 'string' || value.trim().length > 120) {
    return { ok: false, error: 'El título debe ser un texto de 120 caracteres como máximo' };
  }
  return { ok: true, data: value.trim() };
}

function parseHours(value: unknown): ParseResult<number> {
  if (isMissing(value)) return { ok: false, error: 'Las horas son obligatorias' };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { ok: false, error: 'Las horas deben ser un número entero mayor que 0' };
  }
  return { ok: true, data: value };
}

function parseIcon(value: unknown): ParseResult<string | undefined> {
  if (value !== undefined && typeof value !== 'string') return { ok: false, error: 'El icono debe ser un texto' };
  return { ok: true, data: value };
}

function parseLocation(input: Record<string, unknown>): ParseResult<{ lat?: number; lng?: number }> {
  const lat = parseOptionalNumber(input.lat, -90, 90);
  const lng = parseOptionalNumber(input.lng, -180, 180);
  if (lat === null || lng === null) return { ok: false, error: 'La ubicación (lat, lng) no es válida' };
  // Una coordenada sin la otra no sirve para pintar el pin en el mapa.
  if ((lat === undefined) !== (lng === undefined)) {
    return { ok: false, error: 'La ubicación necesita lat y lng a la vez' };
  }
  return { ok: true, data: { lat, lng } };
}

// En update un campo ausente significa "no lo toques"; si llega, se valida igual que en create.
function parseIfPresent<T>(value: unknown, parse: (value: unknown) => ParseResult<T>): ParseResult<T | undefined> {
  return value === undefined ? { ok: true, data: undefined } : parse(value);
}

export function parseCreateCardInput(body: unknown): ParseResult<CreateCardInput> {
  const input = toRecord(body);

  const category = parseCategory(input.category);
  if (!category.ok) return category;
  const description = parseDescription(input.description);
  if (!description.ok) return description;
  const type = parseType(input.type);
  if (!type.ok) return type;
  const title = parseTitle(input.title);
  if (!title.ok) return title;
  const hours = parseHours(input.hours);
  if (!hours.ok) return hours;
  const icon = parseIcon(input.icon);
  if (!icon.ok) return icon;
  const location = parseLocation(input);
  if (!location.ok) return location;

  const scheduleChange = parseScheduleChange(input);
  if (!scheduleChange.ok) return scheduleChange;
  const schedule = resolveSchedule({ startDate: null, endDate: null }, scheduleChange.data);
  if (!schedule.ok) return schedule;

  return {
    ok: true,
    data: {
      type: type.data,
      title: title.data,
      description: description.data,
      category: category.data,
      hours: hours.data,
      icon: icon.data,
      ...location.data,
      ...schedule.data,
    },
  };
}

export interface UpdateCardInput extends ScheduleChange {
  title?: string;
  description?: string;
  category?: CardCategory;
  hours?: number;
  icon?: string;
  lat?: number;
  lng?: number;
}

// El tipo no es editable: se ignora igual que cualquier otro campo desconocido.
export function parseUpdateCardInput(body: unknown): ParseResult<UpdateCardInput> {
  const input = toRecord(body);

  const category = parseIfPresent(input.category, parseCategory);
  if (!category.ok) return category;
  const description = parseIfPresent(input.description, parseDescription);
  if (!description.ok) return description;
  const title = parseIfPresent(input.title, parseTitle);
  if (!title.ok) return title;
  const hours = parseIfPresent(input.hours, parseHours);
  if (!hours.ok) return hours;
  const icon = parseIcon(input.icon);
  if (!icon.ok) return icon;
  const location = parseLocation(input);
  if (!location.ok) return location;
  const schedule = parseScheduleChange(input);
  if (!schedule.ok) return schedule;

  return {
    ok: true,
    data: {
      title: title.data,
      description: description.data,
      category: category.data,
      hours: hours.data,
      icon: icon.data,
      ...location.data,
      ...schedule.data,
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

  const card = await prisma.card.create({
    data: { ...input, authorId: author.id, status: 'active' },
    include: { author: { select: AUTHOR_SELECT } },
  });
  return { ok: true, card };
}

export async function listActiveCards(filters: CardFilters) {
  return prisma.card.findMany({
    where: { status: 'active', ...filters },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: AUTHOR_SELECT } },
  });
}

// Solo lo que pinta un pin del mapa: ni descripción ni autor.
const MAP_CARD_SELECT = { id: true, type: true, category: true, title: true, icon: true, hours: true, lat: true, lng: true } as const;

type MapCard = Prisma.CardGetPayload<{ select: typeof MAP_CARD_SELECT }>;
type LocatedMapCard = MapCard & Coordinates;

// El where ya excluye las cards sin ubicación; el guard se lo dice también al tipo.
function hasCoordinates(card: MapCard): card is LocatedMapCard {
  return card.lat !== null && card.lng !== null;
}

export async function listMapCards(filters: CardFilters): Promise<LocatedMapCard[]> {
  const cards = await prisma.card.findMany({
    where: { ...filters, status: 'active', lat: { not: null }, lng: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: MAP_CARD_SELECT,
  });
  return cards.filter(hasCoordinates);
}

// El mapa es público: también las cards propias salen aproximadas.
export function toMapCardResponse({ lat, lng, ...card }: LocatedMapCard): LocatedMapCard {
  return { ...card, ...toApproximateCoordinates(lat, lng) };
}

// Solo las activas: en el perfil de otra persona no se ven sus cards completadas, denunciadas ni borradas.
export async function listActiveCardsByAuthor(authorId: string, pagination: Pagination) {
  const where = { authorId, status: 'active' } as const;
  const [cards, total] = await Promise.all([
    prisma.card.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: AUTHOR_SELECT } },
      ...toSkipTake(pagination),
    }),
    prisma.card.count({ where }),
  ]);
  return { cards, total };
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

type UpdateCardResult =
  | { ok: true; card: NonNullable<Awaited<ReturnType<typeof findCardById>>> }
  | { ok: false; reason: 'not-found' | 'forbidden' }
  | { ok: false; reason: 'invalid'; error: string };

export async function updateCard(id: string, firebaseUid: string, input: UpdateCardInput): Promise<UpdateCardResult> {
  const card = await prisma.card.findUnique({
    where: { id, status: { not: 'deleted' } },
    select: { startDate: true, endDate: true, author: { select: { firebaseUid: true } } },
  });
  if (!card) return { ok: false, reason: 'not-found' };
  if (card.author.firebaseUid !== firebaseUid) return { ok: false, reason: 'forbidden' };

  // Las reglas de fechas dependen de las que ya tiene la card, por eso se resuelven aquí y no al parsear.
  const { startDate, durationDays, ...fields } = input;
  const schedule = resolveSchedule(card, { startDate, durationDays });
  if (!schedule.ok) return { ok: false, reason: 'invalid', error: schedule.error };

  const updated = await prisma.card.update({
    where: { id },
    data: { ...fields, ...schedule.data },
    include: { author: { select: AUTHOR_SELECT } },
  });
  return { ok: true, card: updated };
}
