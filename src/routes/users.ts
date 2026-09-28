import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { registerCurrentUser } from '../controllers/userController';

const router = Router();

router.post('/me', verifyToken, registerCurrentUser);

export default router;
