import type { ParseResult } from './cardService';

function fieldOf(body: unknown, field: string): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[field] : undefined;
}

// Texto obligatorio, recortado; solo espacios cuenta como vacío.
export function parseRequiredText(body: unknown, field: string, maxLength: number): ParseResult<string> {
  const value = fieldOf(body, field);
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, error: `${field} es obligatorio y debe ser un texto` };
  }
  if (value.trim().length > maxLength) {
    return { ok: false, error: `${field} debe tener ${maxLength} caracteres como máximo` };
  }
  return { ok: true, data: value.trim() };
}

// Texto opcional, recortado: ausente, vacío o solo espacios se guarda como null. Presente con otro tipo (null incluido) es un error.
export function parseOptionalText(body: unknown, field: string, maxLength: number): ParseResult<string | null> {
  const value = fieldOf(body, field);
  if (value === undefined) return { ok: true, data: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} debe ser un texto` };
  if (value.trim().length > maxLength) {
    return { ok: false, error: `${field} debe tener ${maxLength} caracteres como máximo` };
  }
  return { ok: true, data: value.trim() === '' ? null : value.trim() };
}
