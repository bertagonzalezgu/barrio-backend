import type { Request, Response } from 'express';
import { getBalance } from '../services/walletService';

export async function getWalletBalance(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const creditos = await getBalance(req.user.uid);
  if (creditos === null) {
    res.status(404).json({ error: 'Usuario no registrado' });
    return;
  }

  res.json({ creditos });
}
