import type { Request, Response } from 'express';
import { registerUser } from '../services/userService';

export async function registerCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const { uid, email, name: tokenName } = req.user;
  if (!email) {
    res.status(400).json({ error: 'La cuenta de Firebase no tiene email' });
    return;
  }

  const bodyName: unknown = req.body?.name;
  const name = typeof bodyName === 'string' && bodyName.trim() ? bodyName.trim() : tokenName;

  const result = await registerUser({
    firebaseUid: uid,
    email,
    name: typeof name === 'string' ? name : undefined,
  });

  if (!result.ok) {
    res.status(400).json({ error: 'Falta el nombre' });
    return;
  }

  res.json(result.user);
}
