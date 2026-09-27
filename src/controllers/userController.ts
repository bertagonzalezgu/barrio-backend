import type { Request, Response } from 'express';
import { registerUser } from '../services/userService';

export async function registerCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const { uid, email, name } = req.user;
  if (!email) {
    res.status(400).json({ error: 'La cuenta de Firebase no tiene email' });
    return;
  }

  const bodyNombre: unknown = req.body?.nombre;
  const nombre = typeof bodyNombre === 'string' && bodyNombre.trim() ? bodyNombre.trim() : name;

  const result = await registerUser({
    firebaseUid: uid,
    email,
    nombre: typeof nombre === 'string' ? nombre : undefined,
  });

  if (!result.ok) {
    res.status(400).json({ error: 'Falta el nombre' });
    return;
  }

  res.json(result.user);
}
