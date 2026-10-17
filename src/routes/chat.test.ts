import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus, CardType, ExchangeStatus } from '../generated/prisma/client';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

const AUTHOR_UID = 'uid-autora';
const PROPOSER_UID = 'uid-proponente';
const OUTSIDER_UID = 'uid-ajena';
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

// El token es el propio uid: así las peticiones simultáneas no dependen del orden de los mocks.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

interface ExchangeSetup {
  type?: CardType;
  status?: ExchangeStatus;
  cardStatus?: CardStatus;
}

// Autora, proponente y un intercambio sobre una card de la autora; también existe una tercera usuaria registrada.
async function setupExchange({ type = 'request', status = 'proposed', cardStatus = 'active' }: ExchangeSetup = {}) {
  const author = await createUser(AUTHOR_UID);
  const proposer = await createUser(PROPOSER_UID);
  await createUser(OUTSIDER_UID);
  const card = await prisma.card.create({
    data: { authorId: author.id, type, hours: 3, status: cardStatus, title: 'Regar plantas', description: 'Desc', category: 'garden' },
  });
  const exchange = await prisma.exchange.create({
    data: { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours: 3, status },
  });
  return { author, proposer, card, exchange };
}

function getDetail(uid: string, exchangeId: string) {
  return request(app).get(`/api/exchanges/${exchangeId}`).set('Authorization', `Bearer ${uid}`);
}

function getMessages(uid: string, exchangeId: string) {
  return request(app).get(`/api/exchanges/${exchangeId}/messages`).set('Authorization', `Bearer ${uid}`);
}

const ALL_STATUSES: ExchangeStatus[] = ['proposed', 'accepted', 'done', 'confirmed', 'rated', 'cancelled', 'rejected'];

describe('GET /api/exchanges/:id', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/exchanges/x');
    expect(res.status).toBe(401);
  });

  it.each([
    [AUTHOR_UID, 'proposer'],
    [PROPOSER_UID, 'author'],
  ] as const)('%s ve el intercambio con la card y como other a la otra persona', async (uid, otherRole) => {
    const setup = await setupExchange();
    const other = setup[otherRole];

    const res = await getDetail(uid, setup.exchange.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: setup.exchange.id,
      status: 'proposed',
      hours: 3,
      card: { id: setup.card.id, title: 'Regar plantas', type: 'request' },
      other: { id: other.id, name: other.name, avatar: '' },
      myConfirmed: false,
      otherConfirmed: false,
      actions: expect.any(Array),
    });
  });

  it('myConfirmed y otherConfirmed dependen de quién pregunta', async () => {
    const { exchange } = await setupExchange({ status: 'done' });
    await prisma.exchange.update({ where: { id: exchange.id }, data: { proposerConfirmedAt: new Date() } });

    const asProposer = await getDetail(PROPOSER_UID, exchange.id);
    const asAuthor = await getDetail(AUTHOR_UID, exchange.id);

    expect(asProposer.body).toMatchObject({ myConfirmed: true, otherConfirmed: false });
    expect(asAuthor.body).toMatchObject({ myConfirmed: false, otherConfirmed: true });
  });

  // chat.feature — "El chat solo es visible para las dos personas implicadas"
  it('devuelve 404 a una tercera persona y si el intercambio no existe', async () => {
    const { exchange } = await setupExchange();

    for (const [uid, id] of [[OUTSIDER_UID, exchange.id], [AUTHOR_UID, MISSING_ID]]) {
      const res = await getDetail(uid, id);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Exchange not found' });
    }
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const { exchange } = await setupExchange();

    const res = await getDetail('uid-sin-registro', exchange.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  describe('actions', () => {
    it.each([
      ['proposed', AUTHOR_UID, ['accept', 'reject', 'cancel']],
      ['proposed', PROPOSER_UID, ['cancel']],
      ['accepted', AUTHOR_UID, ['cancel']],
      ['accepted', PROPOSER_UID, ['cancel']],
      ['done', AUTHOR_UID, []],
      ['confirmed', PROPOSER_UID, []],
      ['rated', AUTHOR_UID, []],
      ['cancelled', AUTHOR_UID, []],
      ['rejected', PROPOSER_UID, []],
    ] as const)('en %s, %s puede %j', async (status, uid, actions) => {
      const { exchange } = await setupExchange({ status });

      const res = await getDetail(uid, exchange.id);

      expect(res.body.actions).toEqual(actions);
    });

    it('la autora no ve accept si la card ya tiene otro intercambio aceptado', async () => {
      const { author, card, exchange } = await setupExchange();
      const other = await createUser('uid-otra');
      await prisma.exchange.create({
        data: { cardId: card.id, proposerId: other.id, receiverId: author.id, hours: 3, status: 'accepted' },
      });

      const res = await getDetail(AUTHOR_UID, exchange.id);

      expect(res.body.actions).toEqual(['reject', 'cancel']);
    });

    it('la autora no ve accept si la card ya no está activa', async () => {
      const { exchange } = await setupExchange({ cardStatus: 'completed' });

      const res = await getDetail(AUTHOR_UID, exchange.id);

      expect(res.body.actions).toEqual(['reject', 'cancel']);
    });
  });
});

describe('GET /api/exchanges/:id/messages', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/exchanges/x/messages');
    expect(res.status).toBe(401);
  });

  it('devuelve los mensajes por orden de envío y marca los míos', async () => {
    const { author, proposer, exchange } = await setupExchange();
    // Se insertan desordenados para que el orden lo dé sentAt y no el de inserción.
    const second = await prisma.message.create({
      data: { exchangeId: exchange.id, senderId: author.id, text: 'El sábado me va bien', sentAt: new Date('2026-10-02T10:00:00Z') },
    });
    const first = await prisma.message.create({
      data: { exchangeId: exchange.id, senderId: proposer.id, text: '¿Quedamos el sábado?', sentAt: new Date('2026-10-01T10:00:00Z') },
    });

    const res = await getMessages(PROPOSER_UID, exchange.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: first.id, text: '¿Quedamos el sábado?', sentAt: '2026-10-01T10:00:00.000Z', mine: true },
      { id: second.id, text: 'El sábado me va bien', sentAt: '2026-10-02T10:00:00.000Z', mine: false },
    ]);
  });

  it.each(ALL_STATUSES)('las dos personas pueden leer el chat con el intercambio %s', async (status) => {
    const { proposer, exchange } = await setupExchange({ status });
    await prisma.message.create({ data: { exchangeId: exchange.id, senderId: proposer.id, text: 'Hola' } });

    for (const uid of [AUTHOR_UID, PROPOSER_UID]) {
      const res = await getMessages(uid, exchange.id);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    }
  });

  // chat.feature — "El chat solo es visible para las dos personas implicadas"
  it('devuelve 404 a una tercera persona y si el intercambio no existe', async () => {
    const { proposer, exchange } = await setupExchange();
    await prisma.message.create({ data: { exchangeId: exchange.id, senderId: proposer.id, text: 'Hola' } });

    for (const [uid, id] of [[OUTSIDER_UID, exchange.id], [AUTHOR_UID, MISSING_ID]]) {
      const res = await getMessages(uid, id);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Exchange not found' });
    }
  });
});
