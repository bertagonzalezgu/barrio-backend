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
      lat: 41.38512,
      lng: 2.17368,
      ...overrides,
    },
  });
}

function getMapAs(uid: string, query: Record<string, string> = {}) {
  return request(app).get('/api/cards/map').query(query).set('Authorization', `Bearer ${uid}`);
}

describe('GET /api/cards/map', () => {
  it('devuelve 401 sin token', async () => {
    expect((await request(app).get('/api/cards/map')).status).toBe(401);
  });

  it('devuelve solo las cards activas con lat y lng', async () => {
    const ana = await createUser('uid-ana');
    const visible = await createCard(ana.id, { title: 'Visible' });
    await createCard(ana.id, { title: 'Sin ubicación', lat: null, lng: null });
    for (const status of ['completed', 'reported', 'deleted'] as const) await createCard(ana.id, { title: status, status });

    const res = await getMapAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body.map((card: { id: string }) => card.id)).toEqual([visible.id]);
  });

  it('ordena de la más nueva a la más antigua', async () => {
    const ana = await createUser('uid-ana');
    const old = await createCard(ana.id, { createdAt: new Date('2026-01-01') });
    const recent = await createCard(ana.id, { createdAt: new Date('2026-02-01') });

    const res = await getMapAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body.map((card: { id: string }) => card.id)).toEqual([recent.id, old.id]);
  });

  it('filtra por category', async () => {
    const ana = await createUser('uid-ana');
    const digital = await createCard(ana.id, { category: 'digital' });
    await createCard(ana.id, { category: 'garden' });

    const res = await getMapAs('uid-ana', { category: 'digital' });

    expect(res.status).toBe(200);
    expect(res.body.map((card: { id: string }) => card.id)).toEqual([digital.id]);
  });

  it('filtra por type', async () => {
    const ana = await createUser('uid-ana');
    const offer = await createCard(ana.id, { type: 'offer' });
    await createCard(ana.id, { type: 'request' });

    const res = await getMapAs('uid-ana', { type: 'offer' });

    expect(res.status).toBe(200);
    expect(res.body.map((card: { id: string }) => card.id)).toEqual([offer.id]);
  });

  it.each([
    ['category', { category: 'Cuidados' }],
    ['type', { type: 'busco' }],
  ])('devuelve 400 con %s inválido y el mismo error que GET /api/cards', async (_field, query) => {
    const res = await getMapAs('uid-ana', query);
    const feed = await request(app).get('/api/cards').query(query).set('Authorization', 'Bearer uid-ana');

    expect(res.status).toBe(400);
    expect(feed.status).toBe(400);
    expect(res.body).toEqual(feed.body);
  });

  it('devuelve 200 con [] si no hay cards', async () => {
    const res = await getMapAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('redondea lat y lng a 3 decimales, también en las cards propias', async () => {
    const ana = await createUser('uid-ana');
    await createCard(ana.id, { lat: -33.86882, lng: 151.20929 });

    const res = await getMapAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ lat: -33.869, lng: 151.209 });
  });

  it('devuelve solo los campos que pinta el mapa, sin description, authorId ni author', async () => {
    const ana = await createUser('uid-ana');
    const card = await createCard(ana.id, { title: 'Arreglo grifos', category: 'home_repairs', icon: 'wrench', hours: 2 });

    const res = await getMapAs('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: card.id, type: 'offer', category: 'home_repairs', title: 'Arreglo grifos', icon: 'wrench', hours: 2, lat: 41.385, lng: 2.174 },
    ]);
  });
});
