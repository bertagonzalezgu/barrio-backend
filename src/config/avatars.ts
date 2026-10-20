// Set cerrado de avatares: sin subida de ficheros ni URLs libres. Cada clave la resuelve el frontend a su imagen.
// La comparación es exacta (sin recortar ni ignorar mayúsculas). "" (sin avatar) se acepta aparte.
export const AVATARS = [
  'avatar-01',
  'avatar-02',
  'avatar-03',
  'avatar-04',
  'avatar-05',
  'avatar-06',
  'avatar-07',
  'avatar-08',
  'avatar-09',
  'avatar-10',
  'avatar-11',
  'avatar-12',
] as const;

export type Avatar = (typeof AVATARS)[number];
