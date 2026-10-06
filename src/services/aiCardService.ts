import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic } from '../config/anthropic';
import type { CardCategory, CardType } from '../generated/prisma/client';
import { CARD_ICONS, GENERATION_SYSTEM_PROMPT, MODERATION_SYSTEM_PROMPT } from '../prompts/generateCard.prompt';
import {
  CARD_CATEGORIES,
  CARD_TYPES,
  isCardCategory,
  isCardType,
  isMissing,
  type ParseResult,
} from './cardService';

const MODERATION_MODEL = 'claude-haiku-4-5';
const GENERATION_MODEL = 'claude-sonnet-5-5';

export interface GenerateCardInput {
  prompt: string;
  type: CardType;
  category: CardCategory;
}

export interface GeneratedCard {
  titulo: string;
  descripcion: string;
  icono: string;
}

type GenerateCardResult =
  | { ok: true; card: GeneratedCard }
  | { ok: false; reason: 'content-rejected' | 'generation-failed' };

export function parseGenerateCardInput(body: unknown): ParseResult<GenerateCardInput> {
  const input = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const { prompt, type, category } = input;

  if (isMissing(prompt) || typeof prompt !== 'string') return { ok: false, error: 'El texto es obligatorio' };
  if (!isCardType(type)) return { ok: false, error: `El tipo debe ser uno de: ${CARD_TYPES.join(', ')}` };
  if (!isCardCategory(category)) return { ok: false, error: `La categoría debe ser una de: ${CARD_CATEGORIES.join(', ')}` };

  return { ok: true, data: { prompt: prompt.trim(), type, category } };
}

function textOf(content: Array<Anthropic.ContentBlock | Anthropic.Beta.BetaContentBlock>): string {
  for (const block of content) {
    if (block.type === 'text') return block.text;
  }
  throw new Error('La respuesta no contiene texto');
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('La respuesta no es un objeto JSON');
  return parsed as Record<string, unknown>;
}

async function moderate(prompt: string): Promise<{ seguro: boolean; motivo: unknown }> {
  const response = await getAnthropic().messages.create({
    model: MODERATION_MODEL,
    max_tokens: 256,
    system: MODERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const { seguro, motivo } = parseJsonObject(textOf(response.content));
  if (typeof seguro !== 'boolean') throw new Error('La moderación no devolvió "seguro" booleano');
  return { seguro, motivo };
}

async function generate({ prompt, type, category }: GenerateCardInput): Promise<GeneratedCard> {
  // Si Sonnet rechaza la petición por seguridad, el fallback "default" la reintenta con otro modelo en la misma llamada.
  const response = await getAnthropic().beta.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: GENERATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Tipo: ${type}\nCategoría: ${category}\nTexto: ${prompt}` }],
  });

  const { titulo, descripcion, icono } = parseJsonObject(textOf(response.content));
  if (typeof titulo !== 'string' || isMissing(titulo)) throw new Error('Título vacío o inválido');
  if (typeof descripcion !== 'string' || isMissing(descripcion)) throw new Error('Descripción vacía o inválida');
  if (typeof icono !== 'string' || !CARD_ICONS.includes(icono)) throw new Error(`Icono fuera de la lista: ${String(icono)}`);

  return { titulo, descripcion, icono };
}

export async function generateCardWithAI(input: GenerateCardInput): Promise<GenerateCardResult> {
  try {
    const moderation = await moderate(input.prompt);
    if (!moderation.seguro) {
      console.warn('Contenido rechazado por moderación:', moderation.motivo);
      return { ok: false, reason: 'content-rejected' };
    }

    return { ok: true, card: await generate(input) };
  } catch (error) {
    console.error('Fallo al generar la card con IA:', error);
    return { ok: false, reason: 'generation-failed' };
  }
}
