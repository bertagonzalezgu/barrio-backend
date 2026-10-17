import type { NextFunction, Request, Response } from 'express';

// Los errores de express.json (JSON mal formado, cuerpo demasiado grande) traen su propio status 4xx.
function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('status' in error)) return null;
  const { status } = error;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

// Último middleware: el cliente solo recibe un código genérico. El manejador por defecto de Express devuelve
// la traza (con el mensaje interno) fuera de producción.
export function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const status = clientErrorStatus(error);
  if (status) {
    res.status(status).json({ error: 'invalid_request' });
    return;
  }

  console.error('Error no controlado:', error);
  res.status(500).json({ error: 'internal_error' });
}
