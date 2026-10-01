import type { Request, Response } from 'express';
import { createCard, listActiveCards, parseCardFilters, parseCreateCardInput } from '../services/cardService';

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
