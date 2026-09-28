import request from 'supertest';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

function registerAs(token: Record<string, unknown>, body: Record<string, unknown> = {}) {
  mockVerifyIdToken.mockResolvedValueOnce(token as never);
  return request(app)
    .post('/api/users/me')
    .set('Authorization', 'Bearer token-valido')
    .send(body);
}

describe('POST /api/users/me', () => {
  beforeAll(async () => {
    await Transaction.init();
  });

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/users/me');
    expect(res.status).toBe(401);
  });

  // wallet.feature — "Recibir horas de regalo al completar el registro"
  it('crea el usuario con un saldo inicial de 2 horas', async () => {
    const res = await registerAs({ uid: 'uid-nueva', email: 'nueva@barrio.local' }, { name: 'Nueva' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firebaseUid: 'uid-nueva', name: 'Nueva', credits: 2 });
    const user = await User.findOne({ firebaseUid: 'uid-nueva' });
    expect(user?.credits).toBe(2);
    expect(await Transaction.countDocuments({ toUserId: user?._id, type: 'welcome' })).toBe(1);
  });

  it('usa el nombre del token (p. ej. Google) si no viene en el body', async () => {
    const res = await registerAs({ uid: 'uid-google', email: 'g@barrio.local', name: 'Gina' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Gina');
  });

  // wallet.feature — "Las horas de regalo no se duplican"
  it('no añade horas de regalo adicionales si se llama de nuevo (p. ej. al volver a iniciar sesión)', async () => {
    const token = { uid: 'uid-vuelve', email: 'vuelve@barrio.local' };
    await registerAs(token, { name: 'Vuelve' });

    const res = await registerAs(token);

    expect(res.status).toBe(200);
    expect(res.body.credits).toBe(2);
    expect(await User.countDocuments({ firebaseUid: 'uid-vuelve' })).toBe(1);
    expect(await Transaction.countDocuments({ type: 'welcome' })).toBe(1);
  });

  it('devuelve 400 si el token no trae email', async () => {
    const res = await registerAs({ uid: 'uid-sin-email' }, { name: 'X' });
    expect(res.status).toBe(400);
  });

  it('devuelve 400 si no hay nombre ni en el body ni en el token', async () => {
    const res = await registerAs({ uid: 'uid-sin-nombre', email: 'sn@barrio.local' });
    expect(res.status).toBe(400);
  });
});
