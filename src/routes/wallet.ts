import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { getWalletBalance, getWalletTransactions } from '../controllers/walletController';

const router = Router();

router.get('/balance', verifyToken, getWalletBalance);
router.get('/transactions', verifyToken, getWalletTransactions);

export default router;
