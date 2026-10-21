import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus } from '../generated/prisma/client';

const mockVerifyIdToken = vi.fn();
const mockGroqCreate = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('../config/groq', () => ({
  getGroqClient: () => ({ chat: { completions: { create: mockGroqCreate } } }),
}));

import app from '../app';

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

// El token es el propio uid, como en los tests del chat.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string, name = firebaseUid, avatar = '') {
  return prisma.user.create({ data: { firebaseUid, name, avatar, email: `${firebaseUid}@barrio.local` } });
}

function createCard(authorId: string, title: string, status: CardStatus = 'active', createdAt = new Date()) {
  return prisma.card.create({
    data: { authorId, title, status, createdAt, type: 'offer', hours: 1, description: 'Desc', category: 'garden' },
  });
}

function getAs(uid: string, path: string) {
  return request(app).get(path).set('Authorization', `Bearer ${uid}`);
}

// Comprobaciones comunes a los dos listados.
describe.each(['cards', 'reviews'])('GET /api/users/:id/%s — errores comunes', (list) => {
  it('devuelve 401 sin token', async () => {
    expect((await request(app).get(`/api/users/x/${list}`)).status).toBe(401);
  });

  it('devuelve 404 Usuario no registrado si quien pregunta no está registrada', async () => {
    const ana = await createUser('uid-ana');

    const res = await getAs('uid-sin-registro', `/api/users/${ana.id}/${list}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  it.each([MISSING_ID, 'no-es-un-uuid'])('devuelve 404 Usuario no encontrado si el perfil %s no existe', async (id) => {
    await createUser('uid-visita');

    const res = await getAs('uid-visita', `/api/users/${id}/${list}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no encontrado' });
  });

  it.each([
    ['page=0', 'page debe ser un entero mayor que 0'],
    ['page=-1', 'page debe ser un entero mayor que 0'],
    ['page=1.5', 'page debe ser un entero mayor que 0'],
    ['page=abc', 'page debe ser un entero mayor que 0'],
    ['pageSize=0', 'pageSize debe ser un entero entre 1 y 50'],
    ['pageSize=51', 'pageSize debe ser un entero entre 1 y 50'],
    ['pageSize=1&pageSize=2', 'pageSize debe ser un entero entre 1 y 50'],
  ])('devuelve 400 con %s', async (query, error) => {
    const ana = await createUser('uid-ana');

    const res = await getAs('uid-ana', `/api/users/${ana.id}/${list}?${query}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
  });
});

describe('GET /api/users/:id/cards', () => {
  it('devuelve solo las cards activas de esa persona, de la más nueva a la más antigua', async () => {
    const visita = await createUser('uid-visita');
    const ana = await createUser('uid-ana');
    await createCard(ana.id, 'Antigua', 'active', new Date('2026-01-01'));
    await createCard(ana.id, 'Nueva', 'active', new Date('2026-02-01'));
    for (const status of ['completed', 'reported', 'deleted'] as const) await createCard(ana.id, status, status);
    await createCard(visita.id, 'De otra persona');

    const res = await getAs('uid-visita', `/api/users/${ana.id}/cards`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.items.map((card: { title: string }) => card.title)).toEqual(['Nueva', 'Antigua']);
  });

  it('cada card tiene el mismo formato que GET /api/cards/:id, sin datos privados de la autora', async () => {
    await createUser('uid-visita');
    const ana = await createUser('uid-ana');
    const card = await createCard(ana.id, 'Regar plantas');

    const [listed] = (await getAs('uid-visita', `/api/users/${ana.id}/cards`)).body.items;
    const detail = (await getAs('uid-visita', `/api/cards/${card.id}`)).body;

    expect(listed).toMatchObject({ id: card.id, isMine: false, author: { id: ana.id, name: 'uid-ana', avatar: '' } });
    expect(JSON.stringify(listed)).not.toMatch(/email|firebaseUid|uid-ana@/);
    expect(listed).toEqual({ ...detail, author: listed.author });
  });

  it('isMine es true al ver mis propias cards', async () => {
    const ana = await createUser('uid-ana');
    await createCard(ana.id, 'Mía');

    expect((await getAs('uid-ana', `/api/users/${ana.id}/cards`)).body.items[0].isMine).toBe(true);
  });

  it('pagina con page y pageSize y el total no depende de la página', async () => {
    const ana = await createUser('uid-ana');
    for (let day = 1; day <= 5; day++) await createCard(ana.id, `Card ${day}`, 'active', new Date(`2026-01-0${day}`));

    const res = await getAs('uid-ana', `/api/users/${ana.id}/cards?page=2&pageSize=2`);
    const last = await getAs('uid-ana', `/api/users/${ana.id}/cards?page=3&pageSize=2`);
    const beyond = await getAs('uid-ana', `/api/users/${ana.id}/cards?page=9&pageSize=2`);

    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(res.body.items.map((card: { title: string }) => card.title)).toEqual(['Card 3', 'Card 2']);
    expect(last.body.items.map((card: { title: string }) => card.title)).toEqual(['Card 1']);
    expect(beyond.body).toEqual({ items: [], page: 9, pageSize: 2, total: 5 });
  });

  it('sin cards devuelve una lista vacía', async () => {
    const ana = await createUser('uid-ana');

    expect((await getAs('uid-ana', `/api/users/${ana.id}/cards`)).body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });
});

describe('GET /api/users/:id/reviews', () => {
  // Cada valoración en su propio intercambio confirmado, de la persona indicada hacia `ratedId`.
  async function rateFrom(raterId: string, ratedId: string, data: { score: number; comment?: string; commentModerated?: boolean; createdAt?: Date }) {
    const card = await createCard(ratedId, 'Card', 'completed');
    const exchange = await prisma.exchange.create({
      data: { cardId: card.id, proposerId: raterId, receiverId: ratedId, hours: 1, status: 'confirmed' },
    });
    return prisma.rating.create({ data: { exchangeId: exchange.id, raterId, ratedUserId: ratedId, ...data } });
  }

  it('devuelve las valoraciones recibidas con la autora abreviada, de la más nueva a la más antigua', async () => {
    const ana = await createUser('uid-ana');
    const carlos = await createUser('uid-carlos', 'Carlos Pérez García', 'avatar-02');
    const bea = await createUser('uid-bea', 'Bea');
    const old = await rateFrom(carlos.id, ana.id, { score: 5, comment: 'Genial', commentModerated: true, createdAt: new Date('2026-01-01') });
    const recent = await rateFrom(bea.id, ana.id, { score: 3, createdAt: new Date('2026-02-01') });
    await rateFrom(ana.id, carlos.id, { score: 1 });

    const res = await getAs('uid-bea', `/api/users/${ana.id}/reviews`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: recent.id, score: 3, comment: null, createdAt: '2026-02-01T00:00:00.000Z', author: { name: 'Bea', avatar: '' } },
        { id: old.id, score: 5, comment: 'Genial', createdAt: '2026-01-01T00:00:00.000Z', author: { name: 'Carlos P.', avatar: 'avatar-02' } },
      ],
      page: 1,
      pageSize: 20,
      total: 2,
    });
  });

  it('no publica los comentarios guardados antes de que se moderaran', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    await rateFrom(bea.id, ana.id, { score: 2, comment: 'Secreto de antes', commentModerated: false });

    const res = await getAs('uid-bea', `/api/users/${ana.id}/reviews`);

    expect(res.body.items[0].comment).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('Secreto de antes');
  });

  it('un comentario enviado por POST /rating, que ya pasa moderación, sale publicado', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const card = await createCard(ana.id, 'Card', 'completed');
    const exchange = await prisma.exchange.create({
      data: { cardId: card.id, proposerId: bea.id, receiverId: ana.id, hours: 1, status: 'confirmed' },
    });
    mockGroqCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ seguro: true, motivo: 'ok' }) } }] });

    const rating = await request(app)
      .post(`/api/exchanges/${exchange.id}/rating`)
      .set('Authorization', 'Bearer uid-bea')
      .send({ score: 5, comment: 'Muy amable' });

    expect(rating.status).toBe(201);
    expect((await getAs('uid-bea', `/api/users/${ana.id}/reviews`)).body.items[0].comment).toBe('Muy amable');
  });

  it('no incluye email, firebaseUid ni el id de quien valora', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea', 'Bea Soler');
    await rateFrom(bea.id, ana.id, { score: 4 });

    const json = JSON.stringify((await getAs('uid-ana', `/api/users/${ana.id}/reviews`)).body);

    for (const leak of ['email', 'firebaseUid', 'uid-bea', bea.id, 'Soler', 'raterId']) expect(json).not.toContain(leak);
  });

  it.each([
    ['Carlos', 'Carlos'],
    ['  Carlos   pérez  ', 'Carlos P.'],
    ['Àngels Ñúñez Vidal', 'Àngels Ñ.'],
  ])('abrevia "%s" como "%s"', async (name, abbreviated) => {
    const ana = await createUser('uid-ana');
    const rater = await createUser('uid-rater', name);
    await rateFrom(rater.id, ana.id, { score: 4 });

    expect((await getAs('uid-ana', `/api/users/${ana.id}/reviews`)).body.items[0].author.name).toBe(abbreviated);
  });

  it('pagina con page y pageSize', async () => {
    const ana = await createUser('uid-ana');
    for (let day = 1; day <= 3; day++) {
      const rater = await createUser(`uid-r${day}`);
      await rateFrom(rater.id, ana.id, { score: day, createdAt: new Date(`2026-01-0${day}`) });
    }

    const res = await getAs('uid-ana', `/api/users/${ana.id}/reviews?page=2&pageSize=2`);

    expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(res.body.items.map((rating: { score: number }) => rating.score)).toEqual([1]);
  });
});
