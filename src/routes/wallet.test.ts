import request from 'supertest';
import { User } from '../models/User';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

describe('GET /api/wallet/balance', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).toBe(401);
  });

  it('devuelve el saldo del usuario autenticado', async () => {
    await User.create({ firebaseUid: 'uid-ana', name: 'Ana', email: 'ana@barrio.local', credits: 5 });
    await User.create({ firebaseUid: 'uid-otra', name: 'Otra', email: 'otra@barrio.local', credits: 9 });
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-ana' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ credits: 5 });
  });

  it('devuelve 404 si el usuario de Firebase no está registrado en la base de datos', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-sin-registro' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(404);
  });
});
