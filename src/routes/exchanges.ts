import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import {
  getCardExchangeState,
  getExchange,
  getMessages,
  patchConfirm,
  patchExchange,
  postExchange,
  postMessage,
  postReport,
} from '../controllers/exchangeController';

const router = Router();

router.post('/', verifyToken, postExchange);
router.get('/card/:cardId', verifyToken, getCardExchangeState);
router.get('/:id', verifyToken, getExchange);
router.get('/:id/messages', verifyToken, getMessages);
router.post('/:id/messages', verifyToken, postMessage);
router.patch('/:id/accept', verifyToken, patchExchange('accept'));
router.patch('/:id/reject', verifyToken, patchExchange('reject'));
router.patch('/:id/cancel', verifyToken, patchExchange('cancel'));
router.patch('/:id/confirm', verifyToken, patchConfirm);
router.post('/:id/report', verifyToken, postReport);

export default router;
