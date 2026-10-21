import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import {
  getCurrentUser,
  getUserCards,
  getUserProfile,
  getUserReviews,
  patchCurrentUser,
  registerCurrentUser,
} from '../controllers/userController';

const router = Router();

router.get('/me', verifyToken, getCurrentUser);
router.post('/me', verifyToken, registerCurrentUser);
router.patch('/me', verifyToken, patchCurrentUser);
// Después de /me: si fuera antes, "me" se trataría como un id.
router.get('/:id', verifyToken, getUserProfile);
router.get('/:id/cards', verifyToken, getUserCards);
router.get('/:id/reviews', verifyToken, getUserReviews);

export default router;
