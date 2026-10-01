import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getCurrentUser, registerCurrentUser } from '../controllers/userController';

const router = Router();

router.get('/me', verifyToken, getCurrentUser);
router.post('/me', verifyToken, registerCurrentUser);

export default router;
