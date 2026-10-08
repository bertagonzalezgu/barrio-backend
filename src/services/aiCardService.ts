import { getGroqClient } from '../config/groq';
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

const GROQ_MODEL = 'qwen/qwen3.8-27b';

export interface GenerateCardInput {
  prompt: string;
  type: CardType;
  category: CardCategory;
}

export interface GeneratedCard {
  title: string;
  description: string;
  icon: string;
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

async function askGroq(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  });
  const text = response.choices[0]?.message?.content;
  if (!text) throw new Error('Groq no devolvió texto');
  return text;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('La respuesta no es un objeto JSON');
  return parsed as Record<string, unknown>;
}

async function moderate(prompt: string): Promise<{ seguro: boolean; motivo: unknown }> {
  const text = await askGroq(MODERATION_SYSTEM_PROMPT, prompt);
  const { seguro, motivo } = parseJsonObject(text);
  if (typeof seguro !== 'boolean') throw new Error('La moderación no devolvió "seguro" booleano');
  return { seguro, motivo };
}

async function generate({ prompt, type, category }: GenerateCardInput): Promise<GeneratedCard> {
  const text = await askGroq(
    GENERATION_SYSTEM_PROMPT,
    `Tipo: ${type}\nCategoría: ${category}\nTexto: ${prompt}`,
  );

  const { title, description, icon } = parseJsonObject(text);
  if (typeof title !== 'string' || isMissing(title)) throw new Error('Título vacío o inválido');
  if (typeof description !== 'string' || isMissing(description)) throw new Error('Descripción vacía o inválida');
  if (typeof icon !== 'string' || !CARD_ICONS.includes(icon)) throw new Error(`Icono fuera de la lista: ${String(icon)}`);

  return { title, description, icon };
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