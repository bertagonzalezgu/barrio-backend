import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({
    verifyIdToken: mockVerifyIdToken,
  }),
}));

import { verifyToken } from './auth';

function buildApp() {
  const app = express();
  app.get('/protected', verifyToken, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('verifyToken middleware', () => {
  beforeEach(() => {
  mockVerifyIdToken.mockReset();
})

  it('devuelve 401 si no hay header Authorization', async () => {
    const app = buildApp();
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token no proporcionado');
  });

  it('devuelve 401 si el header no empieza por Bearer', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Basic abc123');
    expect(res.status).toBe(401);
  });

  it('devuelve 401 si Firebase rechaza el token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('auth/id-token-expired'));
    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token inválido o expirado');
  });

  it('llama a next() y adjunta req.user si el token es válido', async () => {
    const fakeDecoded = { uid: 'user-123', email: 'test@barrio.app' };
    mockVerifyIdToken.mockResolvedValueOnce(fakeDecoded as never);
    const app = buildApp();
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer token-valido');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});