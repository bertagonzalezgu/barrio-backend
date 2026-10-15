import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getCardExchangeState, postExchange } from '../controllers/exchangeController';

const router = Router();

router.post('/', verifyToken, postExchange);
router.get('/card/:cardId', verifyToken, getCardExchangeState);

export default router;
