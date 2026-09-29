import request from 'supertest';
import { prisma } from '../config/prisma';

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
    const ana = await prisma.user.create({ data: { firebaseUid: 'uid-ana', name: 'Ana', email: 'ana@barrio.local' } });
    const otra = await prisma.user.create({ data: { firebaseUid: 'uid-otra', name: 'Otra', email: 'otra@barrio.local' } });
    await prisma.timeTransaction.createMany({
      data: [
        { type: 'transfer', toUserId: ana.id, hours: 5 },
        { type: 'transfer', toUserId: otra.id, hours: 9 },
      ],
    });
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-ana' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 5, reserved: 0, available: 5 });
  });

  it('devuelve 404 si el usuario de Firebase no está registrado en la base de datos', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-sin-registro' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(404);
  });
});
