import type { Request, Response } from 'express';
import { createExchange, parseCreateExchangeInput, type ExchangeFailure } from '../services/exchangeService';

const EXCHANGE_ERRORS: Record<ExchangeFailure, { status: number; error: string }> = {
  'user-not-found': { status: 404, error: 'Usuario no registrado' },
  'card-not-found': { status: 404, error: 'Card not found' },
  'card-unavailable': { status: 409, error: 'card_unavailable' },
};

function sendFailure(res: Response, reason: ExchangeFailure): void {
  const { status, error } = EXCHANGE_ERRORS[reason];
  res.status(status).json({ error });
}

export async function postExchange(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const parsed = parseCreateExchangeInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const result = await createExchange(req.user.uid, parsed.data);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.status(201).json(result.exchange);
}
