// Set cerrado de avatares: sin subida de ficheros ni URLs libres. "" (sin avatar) se acepta aparte.
// La comparación es exacta: el frontend debe enviar el carácter tal cual, sin selector de variante (U+FE0F).
export const AVATARS = ['🐈', '🐕', '🌿', '🌻', '🎸', '🔧', '📚', '🍳', '🚲', '🏡', '☕', '🧶'] as const;

export type Avatar = (typeof AVATARS)[number];
