import type { Response } from 'express';
import { moderateContent } from '../services/aiCardService';

// Respuesta común para cualquier texto público que se modera (cards, nombre de usuaria).
// Devuelve true si ya ha respondido: 422 si el texto se rechaza, 500 si el clasificador falla.
export async function rejectedByModeration(text: string, res: Response): Promise<boolean> {
  try {
    const moderation = await moderateContent(text);
    if (moderation.seguro) return false;
    res.status(422).json({ error: 'content_rejected', message: moderation.message });
  } catch (error) {
    console.error('Fallo al moderar el contenido:', error);
    res.status(500).json({ error: 'moderation_failed' });
  }
  return true;
}
