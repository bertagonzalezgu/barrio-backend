import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { generateCard, getCalendarCards, getCardById, getCards, getMapCards, patchCard, postCard, removeCard } from '../controllers/cardController';

const router = Router();

router.get('/', verifyToken, getCards);
// Antes de /:id: si no, Express trataría "map" o "calendar" como el id de una card.
router.get('/map', verifyToken, getMapCards);
router.get('/calendar', verifyToken, getCalendarCards);
router.post('/', verifyToken, postCard);
router.post('/generate', verifyToken, generateCard);
router.get('/:id', verifyToken, getCardById);
router.patch('/:id', verifyToken, patchCard);
router.delete('/:id', verifyToken, removeCard);

export default router;
