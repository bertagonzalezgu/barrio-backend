import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getCards, postCard } from '../controllers/cardController';

const router = Router();

router.get('/', verifyToken, getCards);
router.post('/', verifyToken, postCard);

export default router;
