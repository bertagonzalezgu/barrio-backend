import request from 'supertest';
import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';
import { getBalance } from '../services/walletService';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

const AUTHOR_UID = 'uid-autora';
const PROPOSER_UID = 'uid-proponente';
const OUTSIDER_UID = 'uid-ajena';

// El token es el propio uid: así las peticiones simultáneas no dependen del orden de los mocks.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

// Autora, proponente y un intercambio sobre una card de la autora; también existe una tercera usuaria registrada.
async function setupExchange(status: ExchangeStatus = 'confirmed') {
  const author = await createUser(AUTHOR_UID);
  const proposer = await createUser(PROPOSER_UID);
  await createUser(OUTSIDER_UID);
  const card = await prisma.card.create({
    data: { authorId: author.id, type: 'request', hours: 3, status: 'completed', title: 'Regar plantas', description: 'Desc', category: 'garden' },
  });
  const both = ['confirmed', 'rated'].includes(status) ? new Date() : null;
  const exchange = await prisma.exchange.create({
    data: { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours: 3, status, proposerConfirmedAt: both, receiverConfirmedAt: both },
  });
  return { author, proposer, card, exchange };
}

describe('modelo Rating', () => {
  it.each([0, 6])('la base de datos rechaza una puntuación %i aunque se salte la validación de la API', async (score) => {
    const { author, proposer, exchange } = await setupExchange();

    await expect(
      prisma.rating.create({ data: { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score } }),
    ).rejects.toThrow();
    expect(await prisma.rating.count()).toBe(0);
  });

  it('la base de datos rechaza una segunda valoración de la misma persona en el mismo intercambio', async () => {
    const { author, proposer, exchange } = await setupExchange();
    const data = { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 4 };
    await prisma.rating.create({ data });

    await expect(prisma.rating.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.rating.count()).toBe(1);
  });

  it('guarda la valoración con comentario opcional y fecha', async () => {
    const { author, proposer, exchange } = await setupExchange();

    const rating = await prisma.rating.create({
      data: { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 5 },
    });

    expect(rating).toMatchObject({ score: 5, comment: null, createdAt: expect.any(Date) });
  });
});

const MISSING_ID = '00000000-0000-0000-0000-000000000000';
const ALL_STATUSES: ExchangeStatus[] = ['proposed', 'accepted', 'done', 'confirmed', 'rated', 'cancelled', 'rejected'];

function rate(uid: string, exchangeId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/exchanges/${exchangeId}/rating`).set('Authorization', `Bearer ${uid}`).send(body);
}

// confianza.feature — "Valorar tras confirmar un intercambio"
describe('POST /api/exchanges/:id/rating', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/exchanges/x/rating').send({ score: 4 });
    expect(res.status).toBe(401);
  });

  it.each([
    [PROPOSER_UID, 'proposer', 'author'],
    [AUTHOR_UID, 'author', 'proposer'],
  ] as const)('%s valora a la otra persona: guarda la valoración y responde 201 con el detalle', async (uid, raterRole, ratedRole) => {
    const setup = await setupExchange();

    const res = await rate(uid, setup.exchange.id, { score: 4, comment: '  Muy puntual  ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: setup.exchange.id, status: 'confirmed', other: { id: setup[ratedRole].id } });
    expect(await prisma.rating.findMany()).toEqual([
      expect.objectContaining({
        exchangeId: setup.exchange.id,
        raterId: setup[raterRole].id,
        ratedUserId: setup[ratedRole].id,
        score: 4,
        comment: 'Muy puntual',
      }),
    ]);
  });

  it('con la primera valoración el intercambio sigue confirmed', async () => {
    const { exchange } = await setupExchange();

    await rate(PROPOSER_UID, exchange.id, { score: 5 });

    expect(await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).toMatchObject({ status: 'confirmed', ratedAt: null });
  });

  it.each([
    [PROPOSER_UID, AUTHOR_UID],
    [AUTHOR_UID, PROPOSER_UID],
  ])('cuando valora la segunda persona (%s y después %s) el intercambio pasa a rated', async (first, second) => {
    const { exchange } = await setupExchange();
    await rate(first, exchange.id, { score: 5 });

    const res = await rate(second, exchange.id, { score: 4 });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('rated');
    expect(await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).toMatchObject({
      status: 'rated',
      ratedAt: expect.any(Date),
    });
    expect(await prisma.rating.count({ where: { exchangeId: exchange.id } })).toBe(2);
  });

  it.each([
    ['sin comment', { score: 3 }, null],
    ['con comment de solo espacios', { score: 3, comment: '  \n\t ' }, null],
    ['con comment vacío', { score: 3, comment: '' }, null],
    ['con comment de exactamente 500 caracteres', { score: 3, comment: 'a'.repeat(500) }, 'a'.repeat(500)],
  ])('acepta la valoración %s', async (_case, body, comment) => {
    const { exchange } = await setupExchange();

    const res = await rate(PROPOSER_UID, exchange.id, body);

    expect(res.status).toBe(201);
    expect(await prisma.rating.findFirstOrThrow()).toMatchObject({ score: 3, comment });
  });

  it.each([1, 5])('acepta los extremos de la escala: %i', async (score) => {
    const { exchange } = await setupExchange();

    expect((await rate(PROPOSER_UID, exchange.id, { score })).status).toBe(201);
  });

  it.each([
    ['sin score', {}, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con score 0', { score: 0 }, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con score 6', { score: 6 }, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con score decimal', { score: 2.5 }, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con score en texto', { score: '4' }, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con score null', { score: null }, 'score es obligatorio y debe ser un entero entre 1 y 5'],
    ['con comment que no es un texto', { score: 4, comment: 42 }, 'comment debe ser un texto'],
    ['con comment null', { score: 4, comment: null }, 'comment debe ser un texto'],
    ['con comment de más de 500 caracteres', { score: 4, comment: 'a'.repeat(501) }, 'comment debe tener 500 caracteres como máximo'],
  ])('devuelve 400 %s y no guarda nada', async (_case, body, error) => {
    const { exchange } = await setupExchange();

    const res = await rate(PROPOSER_UID, exchange.id, body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
    expect(await prisma.rating.count()).toBe(0);
  });

  it('el límite de 500 se cuenta tras recortar los espacios', async () => {
    const { exchange } = await setupExchange();

    const res = await rate(PROPOSER_UID, exchange.id, { score: 4, comment: `  ${'a'.repeat(500)}  ` });

    expect(res.status).toBe(201);
  });

  it('valorar no crea transferencias ni cambia los saldos', async () => {
    const { author, proposer, exchange } = await setupExchange();
    await prisma.timeTransaction.create({
      data: { type: 'transfer', exchangeId: exchange.id, fromUserId: author.id, toUserId: proposer.id, hours: 3 },
    });
    const before = [await getBalance(AUTHOR_UID), await getBalance(PROPOSER_UID)];

    expect((await rate(PROPOSER_UID, exchange.id, { score: 5 })).status).toBe(201);
    expect((await rate(AUTHOR_UID, exchange.id, { score: 4 })).status).toBe(201);

    expect([await getBalance(AUTHOR_UID), await getBalance(PROPOSER_UID)]).toEqual(before);
    expect(await prisma.timeTransaction.count()).toBe(1);
  });

  // confianza.feature — "No se puede valorar un intercambio sin confirmar"
  it.each(['proposed', 'accepted', 'done', 'cancelled', 'rejected'] as const)(
    'con el intercambio %s devuelve 409 not_confirmed a las dos personas y no guarda nada',
    async (status) => {
      const { exchange } = await setupExchange(status);

      for (const uid of [AUTHOR_UID, PROPOSER_UID]) {
        const res = await rate(uid, exchange.id, { score: 4 });
        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: 'not_confirmed' });
      }
      expect(await prisma.rating.count()).toBe(0);
      expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe(status);
    },
  );

  // confianza.feature — "No se puede valorar dos veces el mismo intercambio"
  it('si la misma persona valora otra vez devuelve 409 already_rated y no cambia su valoración', async () => {
    const { exchange } = await setupExchange();
    await rate(PROPOSER_UID, exchange.id, { score: 5, comment: 'Genial' });

    const res = await rate(PROPOSER_UID, exchange.id, { score: 1, comment: 'Cambio de opinión' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_rated' });
    expect(await prisma.rating.findMany()).toEqual([expect.objectContaining({ score: 5, comment: 'Genial' })]);
  });

  it.each([AUTHOR_UID, PROPOSER_UID])('en un intercambio rated devuelve 409 already_rated a %s', async (uid) => {
    const { author, proposer, exchange } = await setupExchange('rated');
    await prisma.rating.createMany({
      data: [
        { exchangeId: exchange.id, raterId: author.id, ratedUserId: proposer.id, score: 4 },
        { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 5 },
      ],
    });

    const res = await rate(uid, exchange.id, { score: 3 });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_rated' });
    expect(await prisma.rating.count()).toBe(2);
  });

  it('comprueba el cuerpo antes que el estado: cuerpo inválido en un intercambio sin confirmar da 400', async () => {
    const { exchange } = await setupExchange('accepted');

    const res = await rate(PROPOSER_UID, exchange.id, { score: 9 });

    expect(res.status).toBe(400);
  });

  // A quien no participa no le decimos que el intercambio existe, ni en qué estado está.
  it.each(ALL_STATUSES)(
    'con el intercambio %s, a una tercera persona le responde igual que si no existiera, sea cual sea el cuerpo',
    async (status) => {
      const { exchange } = await setupExchange(status);
      const missing = await rate(AUTHOR_UID, MISSING_ID, { score: 4 });

      for (const body of [{ score: 4 }, { score: 9 }, { score: 4, comment: 42 }]) {
        const res = await rate(OUTSIDER_UID, exchange.id, body);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(missing.body);
      }
      expect(missing.status).toBe(404);
      expect(missing.body).toEqual({ error: 'Exchange not found' });
      expect(await prisma.rating.count()).toBe(0);
    },
  );

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const { exchange } = await setupExchange();

    const res = await rate('uid-sin-registro', exchange.id, { score: 4 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });
});
