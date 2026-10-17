import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import {
  getCardExchangeState,
  getExchange,
  getMessages,
  patchExchange,
  postExchange,
} from '../controllers/exchangeController';

const router = Router();

router.post('/', verifyToken, postExchange);
router.get('/card/:cardId', verifyToken, getCardExchangeState);
router.get('/:id', verifyToken, getExchange);
router.get('/:id/messages', verifyToken, getMessages);
router.patch('/:id/accept', verifyToken, patchExchange('accept'));
router.patch('/:id/reject', verifyToken, patchExchange('reject'));
router.patch('/:id/cancel', verifyToken, patchExchange('cancel'));

export default router;
