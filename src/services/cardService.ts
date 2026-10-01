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

type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

type CreateCardResult = { ok: true; card: Card } | { ok: false; reason: 'user-not-found' };

const CARD_TYPES = Object.values(CardType);
const CARD_CATEGORIES = Object.values(CardCategory);

function isCardType(value: unknown): value is CardType {
  return CARD_TYPES.includes(value as CardType);
}

function isCardCategory(value: unknown): value is CardCategory {
  return CARD_CATEGORIES.includes(value as CardCategory);
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function parseOptionalNumber(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function parseOptionalDate(value: unknown): Date | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

  const startDate = parseOptionalDate(input.startDate);
  const endDate = parseOptionalDate(input.endDate);
  if (startDate === null || endDate === null) return { ok: false, error: 'Las fechas deben tener formato ISO 8601' };
  if (startDate && endDate && endDate < startDate) {
    return { ok: false, error: 'La fecha de fin no puede ser anterior a la de inicio' };
  }

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

export async function listActiveCards(filters: CardFilters): Promise<Card[]> {
  return prisma.card.findMany({
    where: { status: 'active', ...filters },
    orderBy: { createdAt: 'desc' },
  });
}
