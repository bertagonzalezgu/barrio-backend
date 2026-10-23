import type { ParseResult } from './cardService';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface Page<T> extends Pagination {
  items: T[];
  total: number;
}

// Paginación por número de página: las listas de un perfil son cortas y el frontend necesita el total para "ver más".
export function parsePagination(query: Record<string, unknown>): ParseResult<Pagination> {
  const { page = '1', pageSize = String(DEFAULT_PAGE_SIZE) } = query;
  if (typeof page !== 'string' || !POSITIVE_INTEGER.test(page)) {
    return { ok: false, error: 'page debe ser un entero mayor que 0' };
  }
  if (typeof pageSize !== 'string' || !POSITIVE_INTEGER.test(pageSize) || Number(pageSize) > MAX_PAGE_SIZE) {
    return { ok: false, error: `pageSize debe ser un entero entre 1 y ${MAX_PAGE_SIZE}` };
  }
  return { ok: true, data: { page: Number(page), pageSize: Number(pageSize) } };
}

export function toSkipTake({ page, pageSize }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
