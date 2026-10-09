import type { Request, Response } from 'express';
import {
  createCard,
  deleteCard,
  findCardById,
  listActiveCards,
  parseCardFilters,
  parseCreateCardInput,
} from '../services/cardService';
import { generateCardWithAI, parseGenerateCardInput } from '../services/aiCardService';

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
    const status = result.reason === 'content-rejected' ? 422 : 500;
    const error = result.reason === 'content-rejected' ? 'content_rejected' : 'generation_failed';
    res.status(status).json({ error });
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
