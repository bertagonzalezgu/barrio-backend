import request from 'supertest';
import { prisma } from '../config/prisma';
import { getBalance } from '../services/walletService';

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
    expect(res.body).toMatchObject({ firebaseUid: 'uid-nueva', name: 'Nueva' });
    expect((await getBalance('uid-nueva'))?.balance).toBe(2);
    expect(await prisma.timeTransaction.count({ where: { toUserId: res.body.id } })).toBe(1);
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
    expect((await getBalance('uid-vuelve'))?.balance).toBe(2);
    expect(await prisma.user.count({ where: { firebaseUid: 'uid-vuelve' } })).toBe(1);
    expect(await prisma.timeTransaction.count()).toBe(1);
  });

  it('no falla ni duplica el usuario si llegan dos registros simultáneos', async () => {
    const token = { uid: 'uid-doble', email: 'doble@barrio.local' };

    const responses = await Promise.all([registerAs(token, { name: 'Doble' }), registerAs(token, { name: 'Doble' })]);

    expect(responses.map((res) => res.status)).toEqual([200, 200]);
    expect(await prisma.user.count({ where: { firebaseUid: 'uid-doble' } })).toBe(1);
    expect((await getBalance('uid-doble'))?.balance).toBe(2);
  });

  it('normaliza el email a minúsculas y recorta espacios del nombre', async () => {
    const res = await registerAs({ uid: 'uid-mayus', email: 'Mayus@Barrio.Local', name: '  Mía  ' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'mayus@barrio.local', name: 'Mía' });
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

describe('GET /api/users/me', () => {
  function getMeAs(token: Record<string, unknown>) {
    mockVerifyIdToken.mockResolvedValueOnce(token as never);
    return request(app).get('/api/users/me').set('Authorization', 'Bearer token-valido');
  }

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('devuelve solo el nombre del usuario autenticado', async () => {
    await prisma.user.create({ data: { firebaseUid: 'uid-me', email: 'me@barrio.local', name: 'Mercè' } });

    const res = await getMeAs({ uid: 'uid-me', email: 'me@barrio.local' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Mercè' });
  });

  it('devuelve 404 si el usuario no está registrado', async () => {
    const res = await getMeAs({ uid: 'uid-fantasma', email: 'f@barrio.local' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
  });
});
