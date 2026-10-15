import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getCardExchangeState, patchExchange, postExchange } from '../controllers/exchangeController';

const router = Router();

router.post('/', verifyToken, postExchange);
router.get('/card/:cardId', verifyToken, getCardExchangeState);
router.patch('/:id/accept', verifyToken, patchExchange('accept'));

export default router;
