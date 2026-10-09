import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { generateCard, getCardById, getCards, postCard, removeCard } from '../controllers/cardController';

const router = Router();

router.get('/', verifyToken, getCards);
router.post('/', verifyToken, postCard);
router.post('/generate', verifyToken, generateCard);
router.get('/:id', verifyToken, getCardById);
router.delete('/:id', verifyToken, removeCard);

export default router;
