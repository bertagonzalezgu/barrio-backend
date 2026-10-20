import type { Request, Response } from 'express';
import { getOwnProfile, getPublicProfile, registerUser } from '../services/userService';

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

export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const profile = await getOwnProfile(req.user.uid);
  if (!profile) {
    res.status(404).json({ error: 'Usuario no encontrado' });
    return;
  }

  res.json(profile);
}

const PROFILE_ERRORS = {
  'user-not-found': 'Usuario no registrado',
  'profile-not-found': 'Usuario no encontrado',
} as const;

export async function getUserProfile(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'No autenticado' });
    return;
  }

  const result = await getPublicProfile(req.user.uid, req.params.id);
  if (!result.ok) {
    res.status(404).json({ error: PROFILE_ERRORS[result.reason] });
    return;
  }

  res.json(result.profile);
}
