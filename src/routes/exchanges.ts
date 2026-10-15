import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import { postExchange } from '../controllers/exchangeController';

const router = Router();

router.post('/', verifyToken, postExchange);

export default router;
