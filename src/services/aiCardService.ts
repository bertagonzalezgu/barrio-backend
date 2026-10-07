import { ThinkingLevel } from '@google/genai';
import { getGeminiClient } from '../config/gemini';
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

const GEMINI_MODEL = 'gemini-3.8-flash';

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

async function askGemini(systemInstruction: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const response = await getGeminiClient().models.generateContent({
    model: GEMINI_MODEL,
    // Razonamiento bajo: los tokens de "pensar" cuentan contra maxOutputTokens y podrían cortar el JSON.
    config: { systemInstruction, maxOutputTokens, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    contents: prompt,
  });
  if (!response.text) throw new Error('Gemini no devolvió texto');
  return response.text;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('La respuesta no es un objeto JSON');
  return parsed as Record<string, unknown>;
}

async function moderate(prompt: string): Promise<{ seguro: boolean; motivo: unknown }> {
  const text = await askGemini(MODERATION_SYSTEM_PROMPT, prompt, 300);

  const { seguro, motivo } = parseJsonObject(text);
  if (typeof seguro !== 'boolean') throw new Error('La moderación no devolvió "seguro" booleano');
  return { seguro, motivo };
}

async function generate({ prompt, type, category }: GenerateCardInput): Promise<GeneratedCard> {
  const text = await askGemini(
    GENERATION_SYSTEM_PROMPT,
    `Tipo: ${type}\nCategoría: ${category}\nTexto: ${prompt}`,
    500,
  );

  const { titulo, descripcion, icono } = parseJsonObject(text);
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
