import type { Request, Response } from 'express';
import {
  createCard,
  deleteCard,
  findCardById,
  listActiveCards,
  listMapCards,
  parseCardFilters,
  parseCreateCardInput,
  parseUpdateCardInput,
  toCardResponse,
  toMapCardResponse,
  updateCard,
} from '../services/cardService';
import { generateCardWithAI, parseGenerateCardInput } from '../services/aiCardService';
import { getAuthorSummary } from '../services/userService';
import { rejectedByModeration } from './moderation';

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

  const textToModerate = [parsed.data.title, parsed.data.description].filter(Boolean).join(' ');
  if (await rejectedByModeration(textToModerate, res)) return;

  const result = await createCard(req.user.uid, parsed.data);
  if (!result.ok) {
    res.status(404).json({ error: 'Usuario no registrado' });
    return;
  }

  res.status(201).json(toCardResponse(result.card, req.user.uid));
}

export async function getCards(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const filters = parseCardFilters(req.query);
  if (!filters.ok) {
    res.status(400).json({ error: filters.error });
    return;
  }

  const { uid } = req.user;
  res.json((await listActiveCards(filters.data)).map((card) => toCardResponse(card, uid)));
}

export async function getMapCards(req: Request, res: Response): Promise<void> {
  const filters = parseCardFilters(req.query);
  if (!filters.ok) {
    res.status(400).json({ error: filters.error });
    return;
  }

  res.json((await listMapCards(filters.data)).map(toMapCardResponse));
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
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const card = await findCardById(req.params.id);
  if (!card) {
    res.status(404).json({ error: 'Card not found' });
    return;
  }

  // Solo en el detalle: en el listado serían varias consultas más por cada card.
  const response = toCardResponse(card, req.user.uid);
  res.json({ ...response, author: { ...response.author, ...(await getAuthorSummary(card.authorId)) } });
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

// Si solo cambia uno de los dos campos, se modera junto al valor guardado del otro para que el clasificador vea la card completa.
async function textToModerateOnUpdate(
  id: string,
  firebaseUid: string,
  { title, description }: { title?: string; description?: string },
): Promise<string> {
  if (title === undefined && description === undefined) return '';

  const card = await findCardById(id);
  // Sin card o sin permiso no se modera: updateCard responde el 404/403.
  if (!card || card.author.firebaseUid !== firebaseUid) return '';

  return [title ?? card.title, description ?? card.description].filter(Boolean).join(' ');
}

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

  const textToModerate = await textToModerateOnUpdate(req.params.id, req.user.uid, parsed.data);
  if (textToModerate && (await rejectedByModeration(textToModerate, res))) return;

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

  res.json(toCardResponse(result.card, req.user.uid));
}
