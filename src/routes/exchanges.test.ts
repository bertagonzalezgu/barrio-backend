import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus, CardType } from '../generated/prisma/client';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

const AUTHOR_UID = 'uid-autora';
const PROPOSER_UID = 'uid-proponente';

// El token es el propio uid: así las peticiones simultáneas no dependen del orden de los mocks.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

async function createUser(firebaseUid: string, hours = 0) {
  const user = await prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
  if (hours > 0) await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: user.id, hours } });
  return user;
}

function createCard(authorId: string, { type = 'request', hours = 2, status = 'active' }: { type?: CardType; hours?: number; status?: CardStatus } = {}) {
  return prisma.card.create({
    data: { authorId, type, hours, status, title: 'Regar plantas', description: 'Desc', category: 'garden' },
  });
}

function propose(uid: string, body: Record<string, unknown>) {
  return request(app).post('/api/exchanges').set('Authorization', `Bearer ${uid}`).send(body);
}

describe('POST /api/exchanges', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/exchanges').send({ cardId: 'x' });
    expect(res.status).toBe(401);
  });

  // match.feature — "Proponer intercambio desde el detalle de una card de tipo busco"
  it('crea una propuesta asociada a la card con la autora como receptora y las horas de la card', async () => {
    const author = await createUser(AUTHOR_UID);
    const proposer = await createUser(PROPOSER_UID);
    const card = await createCard(author.id, { hours: 3 });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      cardId: card.id,
      proposerId: proposer.id,
      receiverId: author.id,
      hours: 3,
      status: 'proposed',
    });
    expect(await prisma.exchange.count()).toBe(1);
  });

  it('devuelve 400 si falta cardId o no es un texto', async () => {
    await createUser(PROPOSER_UID);

    expect((await propose(PROPOSER_UID, {})).status).toBe(400);
    expect((await propose(PROPOSER_UID, { cardId: 42 })).status).toBe(400);
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const author = await createUser(AUTHOR_UID);
    const card = await createCard(author.id);

    const res = await propose('uid-sin-registro', { cardId: card.id });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  it('devuelve 404 si la card no existe o está borrada', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const deleted = await createCard(author.id, { status: 'deleted' });

    for (const cardId of [deleted.id, '00000000-0000-0000-0000-000000000000']) {
      const res = await propose(PROPOSER_UID, { cardId });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Card not found' });
    }
  });

  it('devuelve 409 card_unavailable si la card no está activa', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const card = await createCard(author.id, { status: 'completed' });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'card_unavailable' });
    expect(await prisma.exchange.count()).toBe(0);
  });

  // match.feature — "No se puede proponer intercambio a la propia card"
  it('devuelve 403 si la autora intenta proponer sobre su propia card', async () => {
    const author = await createUser(AUTHOR_UID);
    const card = await createCard(author.id);

    const res = await propose(AUTHOR_UID, { cardId: card.id });

    expect(res.status).toBe(403);
    expect(await prisma.exchange.count()).toBe(0);
  });

  // match.feature — "La card ya tiene un intercambio aceptado con otra persona"
  it.each(['accepted', 'done'] as const)('devuelve 409 card_unavailable si la card ya tiene un intercambio %s', async (status) => {
    const author = await createUser(AUTHOR_UID);
    const other = await createUser('uid-otra');
    await createUser(PROPOSER_UID);
    const card = await createCard(author.id);
    await prisma.exchange.create({
      data: { cardId: card.id, proposerId: other.id, receiverId: author.id, hours: card.hours, status },
    });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'card_unavailable' });
    expect(await prisma.exchange.count()).toBe(1);
  });
});
