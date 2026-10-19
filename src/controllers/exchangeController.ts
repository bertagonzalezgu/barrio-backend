import type { Request, Response } from 'express';
import { listMessages, listMyChats, reportConversation, sendMessage } from '../services/chatService';
import {
  confirmExchange,
  createExchange,
  getExchangeDetail,
  getMyExchangeOnCard,
  transitionExchange,
  type ExchangeAction,
  parseCreateExchangeInput,
  type ExchangeFailure,
} from '../services/exchangeService';
import { rateExchange } from '../services/ratingService';

const EXCHANGE_ERRORS: Record<ExchangeFailure, { status: number; error: string }> = {
  'user-not-found': { status: 404, error: 'Usuario no registrado' },
  'card-not-found': { status: 404, error: 'Card not found' },
  'card-unavailable': { status: 409, error: 'card_unavailable' },
  'own-card': { status: 403, error: 'You cannot propose an exchange on your own card' },
  'already-proposed': { status: 409, error: 'already_proposed' },
  'insufficient-balance': { status: 409, error: 'insufficient_balance' },
  'exchange-not-found': { status: 404, error: 'Exchange not found' },
  forbidden: { status: 403, error: 'Your role in this exchange does not allow this action' },
  'invalid-transition': { status: 409, error: 'invalid_transition' },
  'chat-closed': { status: 409, error: 'chat_closed' },
  'already-confirmed': { status: 409, error: 'already_confirmed' },
  'not-confirmed': { status: 409, error: 'not_confirmed' },
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

export async function getCardExchangeState(req: Request<{ cardId: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await getMyExchangeOnCard(req.user.uid, req.params.cardId);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.json(result.state);
}

export function patchExchange(action: ExchangeAction) {
  return async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    const result = await transitionExchange(req.user.uid, req.params.id, action);
    if (!result.ok) {
      sendFailure(res, result.reason);
      return;
    }

    res.json(result.exchange);
  };
}

export async function getExchange(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await getExchangeDetail(req.user.uid, req.params.id);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.json(result.detail);
}

export async function getMessages(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await listMessages(req.user.uid, req.params.id);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.json(result.messages);
}

// A diferencia del resto de endpoints, el body se valida después de comprobar la participación: ver sendMessage.
export async function postMessage(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await sendMessage(req.user.uid, req.params.id, req.body);
  if (!result.ok) {
    if (result.reason === 'invalid') {
      res.status(400).json({ error: result.error });
      return;
    }
    sendFailure(res, result.reason);
    return;
  }

  res.status(201).json(result.message);
}

export async function patchConfirm(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await confirmExchange(req.user.uid, req.params.id);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.json(result.detail);
}

// Como postMessage: el body se valida después de comprobar la participación.
export async function postReport(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await reportConversation(req.user.uid, req.params.id, req.body);
  if (!result.ok) {
    if (result.reason === 'invalid') {
      res.status(400).json({ error: result.error });
      return;
    }
    sendFailure(res, result.reason);
    return;
  }

  res.status(201).json(result.report);
}

// Como postMessage: el body se valida después de comprobar la participación.
export async function postRating(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await rateExchange(req.user.uid, req.params.id, req.body);
  if (!result.ok) {
    if (result.reason === 'invalid') {
      res.status(400).json({ error: result.error });
      return;
    }
    sendFailure(res, result.reason);
    return;
  }

  res.status(201).json(result.detail);
}

export async function getChats(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await listMyChats(req.user.uid);
  if (!result.ok) {
    sendFailure(res, result.reason);
    return;
  }

  res.json(result.chats);
}
