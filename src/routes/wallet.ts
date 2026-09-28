import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getWalletBalance } from '../controllers/walletController';

const router = Router();

router.get('/balance', verifyToken, getWalletBalance);

export default router;
