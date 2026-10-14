import type { Request, Response } from 'express';
import {
  createCard,
  deleteCard,
  findCardById,
  listActiveCards,
  parseCardFilters,
  parseCreateCardInput,
  parseUpdateCardInput,
  updateCard,
} from '../services/cardService';
import { generateCardWithAI, moderateContent, parseGenerateCardInput } from '../services/aiCardService';

// Segunda moderación: el texto generado por IA se puede editar antes de publicar o después.
// Devuelve true si ya ha respondido (422 o 500) y no hay que guardar nada.
async function rejectedByModeration(text: string, res: Response): Promise<boolean> {
  try {
    const moderation = await moderateContent(text);
    if (moderation.seguro) return false;
    res.status(422).json({ error: 'content_rejected', message: moderation.message });
  } catch (error) {
    console.error('Fallo al moderar la card:', error);
    res.status(500).json({ error: 'moderation_failed' });
  }
  return true;
}

export async function postCard(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const parsed = parseCreateCardInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  if (await rejectedByModeration(parsed.data.description, res)) return;

  const result = await createCard(req.user.uid, parsed.data);
  if (!result.ok) {
    res.status(404).json({ error: 'Usuario no registrado' });
    return;
  }

  res.status(201).json(result.card);
}

export async function getCards(req: Request, res: Response): Promise<void> {
  const filters = parseCardFilters(req.query);
  if (!filters.ok) {
    res.status(400).json({ error: filters.error });
    return;
  }

  res.json(await listActiveCards(filters.data));
}

export async function generateCard(req: Request, res: Response): Promise<void> {
  const parsed = parseGenerateCardInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const result = await generateCardWithAI(parsed.data);
  if (!result.ok) {
    if (result.reason === 'content-rejected') {
      res.status(422).json({ error: 'content_rejected', message: result.message });
      return;
    }
    res.status(500).json({ error: 'generation_failed' });
    return;
  }

  res.json(result.card);
}

export async function getCardById(req: Request<{ id: string }>, res: Response): Promise<void> {
  const card = await findCardById(req.params.id);
  if (!card) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }

  res.json(card);
}

const DELETE_ERRORS = {
  'not-found': { status: 404, error: 'Card not found' },
  forbidden: { status: 403, error: 'Only the author can delete this card' },} as const;

export async function removeCard(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await deleteCard(req.params.id, req.user.uid);
  if (!result.ok) {
    const { status, error } = DELETE_ERRORS[result.reason];
    res.status(status).json({ error });
    return;
  }

  res.status(204).end();
}

const UPDATE_ERRORS = {
  'not-found': { status: 404, error: 'Card not found' },
  forbidden: { status: 403, error: 'Only the author can edit this card' },
} as const;

export async function patchCard(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const parsed = parseUpdateCardInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const { description } = parsed.data;
  if (description !== undefined && (await rejectedByModeration(description, res))) return;

  const result = await updateCard(req.params.id, req.user.uid, parsed.data);
  if (!result.ok) {
    if (result.reason === 'invalid') {
      res.status(400).json({ error: result.error });
      return;
    }
    const { status, error } = UPDATE_ERRORS[result.reason];
    res.status(status).json({ error });
    return;
  }

  res.json(result.card);
}
