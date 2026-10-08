import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { generateCard, getCards, postCard } from '../controllers/cardController';

const router = Router();

router.get('/', verifyToken, getCards);
router.post('/', verifyToken, postCard);
router.post('/generate', verifyToken, generateCard);

export default router;
