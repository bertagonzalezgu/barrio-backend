import request from 'supertest';
import { prisma } from '../config/prisma';
import type { Prisma } from '../generated/prisma/client';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('../config/groq', () => ({
  getGroqClient: () => ({ chat: { completions: { create: vi.fn() } } }),
}));

import app from '../app';

// El token es el propio uid, como en los tests del chat.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

function createCard(authorId: string, overrides: Partial<Prisma.CardUncheckedCreateInput> = {}) {
  return prisma.card.create({
    data: {
      authorId,
      type: 'offer',
      title: 'Card',
      description: 'Desc',
      category: 'garden',
      hours: 1,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-01'),
      ...overrides,
    },
  });
}

function getCalendarAs(uid: string, query: Record<string, string> = {}) {
  return request(app).get('/api/cards/calendar').query(query).set('Authorization', `Bearer ${uid}`);
}

function ids(body: { id: string }[]): string[] {
  return body.map((card) => card.id);
}

describe('GET /api/cards/calendar', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/cards/calendar');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Token no proporcionado' });
  });

  it('devuelve solo las cards activas con startDate y endDate', async () => {
    const ana = await createUser('uid-ana');
    const visible = await createCard(ana.id, { title: 'Visible' });
    await createCard(ana.id, { title: 'Sin fechas', startDate: null, endDate: null });
    for (const status of ['completed', 'reported', 'deleted'] as const) await createCard(ana.id, { title: status, status });

    const res = await getCalendarAs('uid-ana');

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([visible.id]);
  });

  it('incluye cards de varias autoras, no solo las de quien pregunta', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const mine = await createCard(ana.id, { startDate: new Date('2026-11-01'), endDate: new Date('2026-11-01') });
    const theirs = await createCard(bea.id, { startDate: new Date('2026-11-02'), endDate: new Date('2026-11-02') });

    const res = await getCalendarAs('uid-ana');

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([mine.id, theirs.id]);
    expect(res.body.map((card: { isMine: boolean }) => card.isMine)).toEqual([true, false]);
  });

  it('filtra por category', async () => {
    const ana = await createUser('uid-ana');
    const digital = await createCard(ana.id, { category: 'digital' });
    await createCard(ana.id, { category: 'garden' });

    const res = await getCalendarAs('uid-ana', { category: 'digital' });

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([digital.id]);
  });

  it('filtra por type', async () => {
    const ana = await createUser('uid-ana');
    const wanted = await createCard(ana.id, { type: 'request' });
    await createCard(ana.id, { type: 'offer' });

    const res = await getCalendarAs('uid-ana', { type: 'request' });

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([wanted.id]);
  });

  it.each([
    ['category', { category: 'Cuidados' }],
    ['type', { type: 'busco' }],
  ])('devuelve 400 con %s inválido y el mismo error que GET /api/cards', async (_field, query) => {
    const res = await getCalendarAs('uid-ana', query);
    const feed = await request(app).get('/api/cards').query(query).set('Authorization', 'Bearer uid-ana');

    expect(res.status).toBe(400);
    expect(feed.status).toBe(400);
    expect(res.body).toEqual(feed.body);
  });

  it('no incluye lat ni lng, aunque la card tenga ubicación', async () => {
    const ana = await createUser('uid-ana');
    await createCard(ana.id, { lat: 41.38512, lng: 2.17368 });
    await createUser('uid-bea');

    for (const uid of ['uid-ana', 'uid-bea']) {
      const res = await getCalendarAs(uid);

      expect(res.status).toBe(200);
      expect(res.body[0]).not.toHaveProperty('lat');
      expect(res.body[0]).not.toHaveProperty('lng');
    }
  });

  it('ordena por startDate ascendente y, en empate, por id ascendente', async () => {
    const ana = await createUser('uid-ana');
    const sameDay = { startDate: new Date('2026-11-05'), endDate: new Date('2026-11-05') };
    // Se crean en orden inverso al esperado para que el orden no salga del de inserción.
    await createCard(ana.id, { id: '00000000-0000-4000-8000-00000000000b', ...sameDay });
    await createCard(ana.id, { id: '00000000-0000-4000-8000-00000000000a', ...sameDay });
    await createCard(ana.id, { id: '00000000-0000-4000-8000-00000000000c', startDate: new Date('2026-11-01'), endDate: new Date('2026-11-01') });

    const res = await getCalendarAs('uid-ana');

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([
      '00000000-0000-4000-8000-00000000000c',
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000b',
    ]);
  });

  it('devuelve startDate y endDate de una card de varios días', async () => {
    const ana = await createUser('uid-ana');
    await createCard(ana.id, { startDate: new Date('2026-11-02'), endDate: new Date('2026-11-05') });

    const res = await getCalendarAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ startDate: '2026-11-02T00:00:00.000Z', endDate: '2026-11-05T00:00:00.000Z' });
  });

  it('incluye una card activa cuyas fechas ya han pasado', async () => {
    const ana = await createUser('uid-ana');
    // Relativas a hoy para que sigan en el pasado se ejecute cuando se ejecute el test.
    const now = new Date();
    const daysAgo = (days: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
    const past = await createCard(ana.id, { startDate: daysAgo(32), endDate: daysAgo(30) });

    const res = await getCalendarAs('uid-ana');

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([past.id]);
  });
});
