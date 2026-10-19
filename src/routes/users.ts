import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getCurrentUser, getUserProfile, registerCurrentUser } from '../controllers/userController';

const router = Router();

router.get('/me', verifyToken, getCurrentUser);
router.post('/me', verifyToken, registerCurrentUser);
// Después de /me: si fuera antes, "me" se trataría como un id.
router.get('/:id', verifyToken, getUserProfile);

export default router;
