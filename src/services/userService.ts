import { AVATARS, type Avatar } from '../config/avatars';
import { prisma } from '../config/prisma';
import { Prisma, type CardCategory, type ExchangeStatus, type User } from '../generated/prisma/client';
import { CARD_CATEGORIES, isCardCategory, type ParseResult } from './cardService';
import { findUserId } from './exchangeService';
import { parseOptionalText, parseRequiredText } from './textInput';
import { grantWelcomeCredit } from './walletService';

interface RegisterUserInput {
  firebaseUid: string;
  email: string;
  name?: string;
}

type RegisterUserResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'missing-name' };

export async function registerUser({ firebaseUid, email, name }: RegisterUserInput): Promise<RegisterUserResult> {
  let user = await prisma.user.findUnique({ where: { firebaseUid } });

  if (!user) {
    const trimmedName = name?.trim();
    if (!trimmedName) return { ok: false, reason: 'missing-name' };
    user = await createOrGetConcurrent(firebaseUid, email.trim().toLowerCase(), trimmedName);
  }

  await grantWelcomeCredit(user.id);

  return { ok: true, user };
}

async function createOrGetConcurrent(firebaseUid: string, email: string, name: string): Promise<User> {
  try {
    return await prisma.user.create({ data: { firebaseUid, email, name } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await prisma.user.findUnique({ where: { firebaseUid } });
    if (!existing) throw error;
    return existing;
  }
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar: string;
  verified: boolean;
  ratingAverage: number | null;
  ratingCount: number;
  exchangeCount: number;
  createdAt: Date;
  interests: CardCategory[];
  offers: CardCategory[];
  bio: string | null;
}

// Solo la propia persona ve si ya pasó el onboarding: al resto no le dice nada.
export interface OwnProfile extends PublicProfile {
  onboardingCompletedAt: Date | null;
}

type PublicProfileResult = { ok: true; profile: PublicProfile } | { ok: false; reason: 'user-not-found' | 'profile-not-found' };

// Intercambios que llegaron a completarse: las dos personas confirmaron, hayan valorado o no.
const COMPLETED_STATUSES: ExchangeStatus[] = ['confirmed', 'rated'];

// Select explícito: del perfil de otra persona nunca sale su email, su firebaseUid ni nada del wallet.
const PUBLIC_PROFILE_SELECT = {
  id: true,
  name: true,
  avatar: true,
  verified: true,
  registeredAt: true,
  interests: true,
  offers: true,
  bio: true,
} as const;

export async function userExists(userId: string): Promise<boolean> {
  return (await prisma.user.count({ where: { id: userId } })) > 0;
}

export async function getPublicProfile(firebaseUid: string, userId: string): Promise<PublicProfileResult> {
  if (!(await findUserId(firebaseUid))) return { ok: false, reason: 'user-not-found' };

  const profile = await buildProfile(userId);
  return profile ? { ok: true, profile } : { ok: false, reason: 'profile-not-found' };
}

export interface Reputation {
  ratingAverage: number | null;
  ratingCount: number;
  exchangeCount: number;
}

// La media no se guarda: se calcula al leer, igual que el saldo sale de TimeTransaction.
// Así nunca puede quedar desfasada respecto a las valoraciones que hay de verdad.
export async function getReputation(userId: string): Promise<Reputation> {
  const [ratings, exchangeCount] = await Promise.all([
    prisma.rating.aggregate({ where: { ratedUserId: userId }, _avg: { score: true }, _count: true }),
    prisma.exchange.count({
      where: { status: { in: COMPLETED_STATUSES }, OR: [{ proposerId: userId }, { receiverId: userId }] },
    }),
  ]);
  const average = ratings._avg.score;

  return {
    // Sin valoraciones es null y no 0: un 0 se leería como "la peor nota".
    ratingAverage: average === null ? null : Math.round(average * 10) / 10,
    ratingCount: ratings._count,
    exchangeCount,
  };
}

export interface AuthorSummary extends Reputation {
  verified: boolean;
}

// Lo que el detalle de una card añade de su autora para el bloque de confianza, sin pedir el perfil entero.
export async function getAuthorSummary(userId: string): Promise<AuthorSummary> {
  const [{ verified }, reputation] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { verified: true } }),
    getReputation(userId),
  ]);
  return { verified, ...reputation };
}

async function buildProfile(userId: string): Promise<PublicProfile | null> {
  const found = await prisma.user.findUnique({ where: { id: userId }, select: PUBLIC_PROFILE_SELECT });
  if (!found) return null;
  // En la API se llama createdAt, como en el resto de recursos; la columna es registeredAt.
  const { registeredAt, ...user } = found;
  return { ...user, ...(await getReputation(userId)), createdAt: registeredAt };
}

async function buildOwnProfile(userId: string): Promise<OwnProfile | null> {
  const [profile, own] = await Promise.all([
    buildProfile(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { onboardingCompletedAt: true } }),
  ]);
  return profile && own ? { ...profile, ...own } : null;
}

const NAME_MAX_LENGTH = 80;
const BIO_MAX_LENGTH = 280;
// Hay 15 categorías y no se aceptan repetidas, así que hoy el tope coincide con elegirlas todas.
const MAX_CATEGORIES = 15;
const EDITABLE_FIELDS = ['name', 'avatar', 'bio', 'interests', 'offers', 'onboardingCompleted'] as const;

export interface ProfileChanges {
  name?: string;
  avatar?: string;
  // null borra la bio.
  bio?: string | null;
  interests?: CardCategory[];
  offers?: CardCategory[];
  onboardingCompleted?: true;
}

// "" es "sin avatar": el frontend pinta la inicial del nombre.
function isAvatar(value: unknown): value is string {
  return value === '' || AVATARS.includes(value as Avatar);
}

// Sin conversiones, como el resto de la API: ni una categoría suelta en vez de lista, ni repetidas.
function parseCategoryList(value: unknown, field: string): ParseResult<CardCategory[]> {
  if (!Array.isArray(value) || !value.every(isCardCategory)) {
    return { ok: false, error: `${field} debe ser una lista de categorías: ${CARD_CATEGORIES.join(', ')}` };
  }
  if (value.length > MAX_CATEGORIES) {
    return { ok: false, error: `${field} puede tener ${MAX_CATEGORIES} categorías como máximo` };
  }
  if (new Set(value).size !== value.length) return { ok: false, error: `${field} no puede tener categorías repetidas` };
  return { ok: true, data: value };
}

// Solo se lee lo que se puede editar: el resto de campos del cuerpo (email, verified…) se ignora.
export function parseProfileChanges(body: unknown): ParseResult<ProfileChanges> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  if (EDITABLE_FIELDS.every((field) => input[field] === undefined)) {
    return { ok: false, error: `Envía al menos uno de: ${EDITABLE_FIELDS.join(', ')}` };
  }

  const changes: ProfileChanges = {};
  if (input.name !== undefined) {
    const name = parseRequiredText(input, 'name', NAME_MAX_LENGTH);
    if (!name.ok) return name;
    changes.name = name.data;
  }
  if (input.avatar !== undefined) {
    if (!isAvatar(input.avatar)) {
      return { ok: false, error: `avatar debe ser uno de: ${AVATARS.join(', ')} o "" para no tener avatar` };
    }
    changes.avatar = input.avatar;
  }
  if (input.bio !== undefined) {
    // "" o solo espacios borra la bio, igual que el comentario de una valoración.
    const bio = parseOptionalText(input, 'bio', BIO_MAX_LENGTH);
    if (!bio.ok) return bio;
    changes.bio = bio.data;
  }
  for (const field of ['interests', 'offers'] as const) {
    if (input[field] === undefined) continue;
    const list = parseCategoryList(input[field], field);
    if (!list.ok) return list;
    changes[field] = list.data;
  }
  if (input.onboardingCompleted !== undefined) {
    // La fecha la pone el servidor: el cliente solo puede decir que ha terminado, no cuándo ni deshacerlo.
    if (input.onboardingCompleted !== true) return { ok: false, error: 'onboardingCompleted solo admite true' };
    changes.onboardingCompleted = true;
  }
  return { ok: true, data: changes };
}

// El nombre no se copia en ningún sitio: cards y chats lo leen con join, así que el cambio se ve en todas partes.
export async function updateOwnProfile(userId: string, { onboardingCompleted, ...changes }: ProfileChanges): Promise<OwnProfile> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: changes }),
    // Solo la primera vez: repetir el onboarding no cambia la fecha en que se completó.
    ...(onboardingCompleted
      ? [prisma.user.updateMany({ where: { id: userId, onboardingCompletedAt: null }, data: { onboardingCompletedAt: new Date() } })]
      : []),
  ]);
  const profile = await buildOwnProfile(userId);
  if (!profile) throw new Error(`No existe el usuario ${userId}`);
  return profile;
}

// Mi perfil es el público más lo que solo me importa a mí (onboardingCompletedAt): el frontend puede extender un solo tipo.
export async function getOwnProfile(firebaseUid: string): Promise<OwnProfile | null> {
  const userId = await findUserId(firebaseUid);
  return userId ? buildOwnProfile(userId) : null;
}
