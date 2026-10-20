import request from 'supertest';
import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';
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

  // La media de valoraciones se calcula al leer el perfil público, ya no es una columna del usuario.
  it('la respuesta no incluye una columna rating', async () => {
    const res = await registerAs({ uid: 'uid-sin-rating', email: 'sr@barrio.local' }, { name: 'Sara' });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('rating');
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

  // perfil.feature — "Ver mi perfil con historial de créditos": la parte del perfil; el historial va en wallet.
  it('devuelve mi perfil con la misma forma que el perfil público', async () => {
    const me = await prisma.user.create({ data: { firebaseUid: 'uid-me', email: 'me@barrio.local', name: 'Mercè' } });

    const res = await getMeAs({ uid: 'uid-me', email: 'me@barrio.local' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: me.id,
      name: 'Mercè',
      avatar: '',
      verified: false,
      ratingAverage: null,
      ratingCount: 0,
      exchangeCount: 0,
      createdAt: me.registeredAt.toISOString(),
    });
  });

  it('incluye mi media, las valoraciones recibidas y los intercambios completados', async () => {
    const me = await prisma.user.create({ data: { firebaseUid: 'uid-me', email: 'me@barrio.local', name: 'Mercè' } });
    const other = await prisma.user.create({ data: { firebaseUid: 'uid-otra', email: 'otra@barrio.local', name: 'Otra' } });
    const card = await prisma.card.create({
      data: { authorId: me.id, type: 'offer', hours: 1, status: 'completed', title: 'Card', description: 'Desc', category: 'garden' },
    });
    const exchange = await prisma.exchange.create({ data: { cardId: card.id, proposerId: other.id, receiverId: me.id, hours: 1, status: 'confirmed' } });
    await prisma.rating.create({ data: { exchangeId: exchange.id, raterId: other.id, ratedUserId: me.id, score: 4 } });

    const res = await getMeAs({ uid: 'uid-me', email: 'me@barrio.local' });

    expect(res.body).toMatchObject({ ratingAverage: 4, ratingCount: 1, exchangeCount: 1 });
  });

  // perfil.feature — "Ver la insignia de verificado"
  it('con la identidad verificada devuelve verified true', async () => {
    await prisma.user.create({ data: { firebaseUid: 'uid-me', email: 'me@barrio.local', name: 'Mercè', verified: true } });

    const res = await getMeAs({ uid: 'uid-me', email: 'me@barrio.local' });

    expect(res.body.verified).toBe(true);
  });

  it('no incluye email, firebaseUid ni el saldo en ninguna parte del JSON', async () => {
    await prisma.user.create({ data: { firebaseUid: 'uid-me', email: 'me@barrio.local', name: 'Mercè' } });

    const res = await getMeAs({ uid: 'uid-me', email: 'me@barrio.local' });

    const json = JSON.stringify(res.body);
    for (const leak of ['"email"', '"firebaseUid"', 'me@barrio.local', 'uid-me', '"balance"', 'welcomeCredit']) {
      expect(json).not.toContain(leak);
    }
  });

  it('devuelve 404 si el usuario no está registrado', async () => {
    const res = await getMeAs({ uid: 'uid-fantasma', email: 'f@barrio.local' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
  });
});

// confianza.feature — "La valoración es visible en el perfil público"
describe('GET /api/users/:id', () => {
  const MISSING_ID = '00000000-0000-0000-0000-000000000000';

  // El token es el propio uid, como en los tests del chat.
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
  });

  function createUser(firebaseUid: string, data: { avatar?: string; verified?: boolean } = {}) {
    return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local`, ...data } });
  }

  async function createExchange(proposerId: string, receiverId: string, status: ExchangeStatus) {
    const card = await prisma.card.create({
      data: { authorId: receiverId, type: 'request', hours: 1, status: 'completed', title: 'Card', description: 'Desc', category: 'garden' },
    });
    return prisma.exchange.create({ data: { cardId: card.id, proposerId, receiverId, hours: 1, status } });
  }

  // Cada valoración en su propio intercambio confirmado, de una persona distinta, hacia `rated`.
  async function receiveRatings(ratedId: string, scores: number[]) {
    for (const [i, score] of scores.entries()) {
      const rater = await createUser(`uid-valora-${i}`);
      const exchange = await createExchange(rater.id, ratedId, 'confirmed');
      await prisma.rating.create({ data: { exchangeId: exchange.id, raterId: rater.id, ratedUserId: ratedId, score, comment: 'Secreto' } });
    }
  }

  function getProfile(uid: string, id: string) {
    return request(app).get(`/api/users/${id}`).set('Authorization', `Bearer ${uid}`);
  }

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/users/x');
    expect(res.status).toBe(401);
  });

  it('devuelve exactamente los campos públicos: ni email, ni firebaseUid, ni comentarios', async () => {
    await createUser('uid-visita');
    const ana = await createUser('uid-ana', { avatar: 'https://img/ana.png', verified: true });
    await receiveRatings(ana.id, [5]);

    const res = await getProfile('uid-visita', ana.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: ana.id,
      name: 'uid-ana',
      avatar: 'https://img/ana.png',
      verified: true,
      ratingAverage: 5,
      ratingCount: 1,
      exchangeCount: 1,
      createdAt: ana.registeredAt.toISOString(),
    });
    expect(JSON.stringify(res.body)).not.toContain('Secreto');
  });

  it('createdAt es la fecha de registro en ISO 8601', async () => {
    const ana = await createUser('uid-ana');

    const { createdAt } = (await getProfile('uid-ana', ana.id)).body;

    expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(createdAt).getTime()).toBe(ana.registeredAt.getTime());
  });

  it('sin valoraciones, ratingAverage es null (nunca 0) y los contadores son 0', async () => {
    const ana = await createUser('uid-ana');

    const res = await getProfile('uid-ana', ana.id);

    expect(res.body).toMatchObject({ ratingAverage: null, ratingCount: 0, exchangeCount: 0 });
  });

  it.each([
    [[4, 5], 4.5],
    [[5, 4, 4], 4.3],
    [[5, 5, 4], 4.7],
  ])('con las puntuaciones %j la media redondeada a un decimal es %d', async (scores, average) => {
    const ana = await createUser('uid-ana');
    await receiveRatings(ana.id, scores);

    const res = await getProfile('uid-ana', ana.id);

    expect(res.body).toMatchObject({ ratingAverage: average, ratingCount: scores.length });
  });

  it('solo cuentan las valoraciones recibidas, no las que da', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const exchange = await createExchange(ana.id, bea.id, 'confirmed');
    await prisma.rating.create({ data: { exchangeId: exchange.id, raterId: ana.id, ratedUserId: bea.id, score: 1 } });

    expect((await getProfile('uid-ana', ana.id)).body).toMatchObject({ ratingAverage: null, ratingCount: 0 });
    expect((await getProfile('uid-ana', bea.id)).body).toMatchObject({ ratingAverage: 1, ratingCount: 1 });
  });

  it('exchangeCount cuenta confirmed y rated como proponente y como receptora, y nada más', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    await createExchange(ana.id, bea.id, 'confirmed');
    await createExchange(bea.id, ana.id, 'confirmed');
    await createExchange(ana.id, bea.id, 'rated');
    await createExchange(bea.id, ana.id, 'rated');
    for (const status of ['proposed', 'accepted', 'done', 'cancelled', 'rejected'] as const) {
      await createExchange(ana.id, bea.id, status);
      await createExchange(bea.id, ana.id, status);
    }
    const carla = await createUser('uid-carla');
    await createExchange(bea.id, carla.id, 'confirmed');

    expect((await getProfile('uid-ana', ana.id)).body.exchangeCount).toBe(4);
  });

  it('refleja la valoración recién enviada desde el chat', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const exchange = await createExchange(bea.id, ana.id, 'confirmed');

    const rating = await request(app).post(`/api/exchanges/${exchange.id}/rating`).set('Authorization', 'Bearer uid-bea').send({ score: 4 });
    expect(rating.status).toBe(201);

    expect((await getProfile('uid-bea', ana.id)).body).toMatchObject({ ratingAverage: 4, ratingCount: 1, exchangeCount: 1 });
  });

  it.each([MISSING_ID, 'no-es-un-uuid'])('devuelve 404 si el usuario %s no existe', async (id) => {
    await createUser('uid-visita');

    const res = await getProfile('uid-visita', id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
  });

  it('devuelve 404 Usuario no registrado si quien pregunta no está registrada', async () => {
    const ana = await createUser('uid-ana');

    const res = await getProfile('uid-sin-registro', ana.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  it('/me sigue yendo a sus propias rutas y no se interpreta como un id', async () => {
    const ana = await createUser('uid-ana');

    const res = await request(app).get('/api/users/me').set('Authorization', 'Bearer uid-ana');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ana.id, name: 'uid-ana' });
  });
});
