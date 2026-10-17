import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus, CardType } from '../generated/prisma/client';
import { getBalance } from '../services/walletService';

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

function getCardState(uid: string, cardId: string) {
  return request(app).get(`/api/exchanges/card/${cardId}`).set('Authorization', `Bearer ${uid}`);
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

  it('devuelve 409 already_proposed si ya tengo una propuesta activa sobre la card', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const card = await createCard(author.id);
    await propose(PROPOSER_UID, { cardId: card.id });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_proposed' });
    expect(await prisma.exchange.count()).toBe(1);
  });

  it.each(['cancelled', 'rejected'] as const)('permite volver a proponer tras una propuesta %s', async (status) => {
    const author = await createUser(AUTHOR_UID);
    const proposer = await createUser(PROPOSER_UID);
    const card = await createCard(author.id);
    await prisma.exchange.create({
      data: { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours: card.hours, status },
    });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(201);
    expect(await prisma.exchange.count()).toBe(2);
  });

  it('dos propuestas simultáneas de la misma persona solo crean una', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const card = await createCard(author.id);

    const results = await Promise.all([propose(PROPOSER_UID, { cardId: card.id }), propose(PROPOSER_UID, { cardId: card.id })]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.exchange.count()).toBe(1);
  });

  // wallet.feature — "Saldo insuficiente"
  it('en una card offer no crea la propuesta si mi saldo disponible no cubre las horas', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID, 2);
    const card = await createCard(author.id, { type: 'offer', hours: 3 });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'insufficient_balance' });
    expect(await prisma.exchange.count()).toBe(0);
  });

  // wallet.feature — "Saldo insuficiente": cuenta el disponible, no el total
  it('en una card offer tiene en cuenta las horas que ya tengo reservadas', async () => {
    const author = await createUser(AUTHOR_UID);
    const proposer = await createUser(PROPOSER_UID, 5);
    const reservedCard = await createCard(author.id, { type: 'offer', hours: 3 });
    await prisma.exchange.create({
      data: { cardId: reservedCard.id, proposerId: proposer.id, receiverId: author.id, hours: 3, status: 'accepted' },
    });
    const card = await createCard(author.id, { type: 'offer', hours: 3 });

    const res = await propose(PROPOSER_UID, { cardId: card.id });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'insufficient_balance' });
  });

  it('en una card offer crea la propuesta si el saldo disponible cubre justo las horas', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID, 3);
    const card = await createCard(author.id, { type: 'offer', hours: 3 });

    expect((await propose(PROPOSER_UID, { cardId: card.id })).status).toBe(201);
  });

  it('en una card request no exige saldo a quien propone, porque paga la autora', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID, 0);
    const card = await createCard(author.id, { type: 'request', hours: 3 });

    expect((await propose(PROPOSER_UID, { cardId: card.id })).status).toBe(201);
  });
});

describe('GET /api/exchanges/card/:cardId', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/exchanges/card/x');
    expect(res.status).toBe(401);
  });

  // match.feature — "Ya he propuesto y no han respondido: veo Propuesta enviada"
  it('devuelve mi propuesta pendiente sobre la card', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const card = await createCard(author.id);
    const proposal = await propose(PROPOSER_UID, { cardId: card.id });

    const res = await getCardState(PROPOSER_UID, card.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mine: { id: proposal.body.id, status: 'proposed' }, cardAvailable: true });
  });

  it('devuelve mine null si no he propuesto nada, y también para la autora', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    await createUser('uid-otra');
    const card = await createCard(author.id);
    await propose('uid-otra', { cardId: card.id });

    for (const uid of [PROPOSER_UID, AUTHOR_UID]) {
      const res = await getCardState(uid, card.id);
      expect(res.body).toEqual({ mine: null, cardAvailable: true });
    }
  });

  it('devuelve mi propuesta más reciente si he vuelto a proponer tras cancelar', async () => {
    const author = await createUser(AUTHOR_UID);
    const proposer = await createUser(PROPOSER_UID);
    const card = await createCard(author.id);
    const base = { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours: card.hours };
    await prisma.exchange.create({ data: { ...base, status: 'cancelled', proposedAt: new Date('2026-10-01') } });
    const latest = await prisma.exchange.create({ data: { ...base, status: 'proposed', proposedAt: new Date('2026-10-02') } });

    const res = await getCardState(PROPOSER_UID, card.id);

    expect(res.body.mine).toEqual({ id: latest.id, status: 'proposed' });
  });

  // match.feature — "La card ya tiene un intercambio aceptado con otra persona"
  it('marca la card como no disponible si tiene un intercambio aceptado o no está activa', async () => {
    const author = await createUser(AUTHOR_UID);
    const other = await createUser('uid-otra');
    await createUser(PROPOSER_UID);
    const taken = await createCard(author.id);
    await prisma.exchange.create({
      data: { cardId: taken.id, proposerId: other.id, receiverId: author.id, hours: taken.hours, status: 'accepted' },
    });
    const completed = await createCard(author.id, { status: 'completed' });

    for (const card of [taken, completed]) {
      const res = await getCardState(PROPOSER_UID, card.id);
      expect(res.body).toEqual({ mine: null, cardAvailable: false });
    }
  });

  it('devuelve 404 si la card no existe o está borrada', async () => {
    const author = await createUser(AUTHOR_UID);
    await createUser(PROPOSER_UID);
    const deleted = await createCard(author.id, { status: 'deleted' });

    const res = await getCardState(PROPOSER_UID, deleted.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Card not found' });
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const author = await createUser(AUTHOR_UID);
    const card = await createCard(author.id);

    const res = await getCardState('uid-sin-registro', card.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });
});

function transition(uid: string, exchangeId: string, action: 'accept' | 'reject' | 'cancel') {
  return request(app).patch(`/api/exchanges/${exchangeId}/${action}`).set('Authorization', `Bearer ${uid}`);
}

// Autora con saldo, proponente con saldo y una propuesta en `proposed` sobre una card del tipo indicado.
async function setupProposal(type: CardType, { hours = 3, authorHours = 5, proposerHours = 5 } = {}) {
  const author = await createUser(AUTHOR_UID, authorHours);
  const proposer = await createUser(PROPOSER_UID, proposerHours);
  const card = await createCard(author.id, { type, hours });
  const exchange = await prisma.exchange.create({
    data: { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours },
  });
  return { author, proposer, card, exchange };
}

describe('PATCH /api/exchanges/:id/accept', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).patch('/api/exchanges/x/accept');
    expect(res.status).toBe(401);
  });

  it('en una card offer pasa a accepted y reserva las horas de quien propone', async () => {
    const { exchange } = await setupProposal('offer');

    const res = await transition(AUTHOR_UID, exchange.id, 'accept');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: exchange.id, status: 'accepted', acceptedAt: expect.any(String) });
    expect(await getBalance(PROPOSER_UID)).toEqual({ balance: 5, reserved: 3, available: 2 });
    expect(await getBalance(AUTHOR_UID)).toEqual({ balance: 5, reserved: 0, available: 5 });
    expect(await prisma.timeTransaction.count({ where: { exchangeId: exchange.id } })).toBe(0);
  });

  it('en una card request pasa a accepted y reserva las horas de la autora', async () => {
    const { exchange } = await setupProposal('request');

    const res = await transition(AUTHOR_UID, exchange.id, 'accept');

    expect(res.status).toBe(200);
    expect(await getBalance(AUTHOR_UID)).toEqual({ balance: 5, reserved: 3, available: 2 });
    expect(await getBalance(PROPOSER_UID)).toEqual({ balance: 5, reserved: 0, available: 5 });
  });

  it('devuelve 403 si quien acepta es la proponente', async () => {
    const { exchange } = await setupProposal('request');

    const res = await transition(PROPOSER_UID, exchange.id, 'accept');

    expect(res.status).toBe(403);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe('proposed');
  });

  it('devuelve 404 si el intercambio no existe o no participo en él', async () => {
    const { exchange } = await setupProposal('request');
    await createUser('uid-ajena');

    expect((await transition('uid-ajena', exchange.id, 'accept')).status).toBe(404);
    expect((await transition(AUTHOR_UID, '00000000-0000-0000-0000-000000000000', 'accept')).status).toBe(404);
  });

  it.each(['accepted', 'rejected', 'cancelled'] as const)('devuelve 409 invalid_transition si el intercambio está %s', async (status) => {
    const { exchange } = await setupProposal('request');
    await prisma.exchange.update({ where: { id: exchange.id }, data: { status } });

    const res = await transition(AUTHOR_UID, exchange.id, 'accept');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invalid_transition' });
  });

  it('devuelve 409 card_unavailable si la card ya tiene otra propuesta aceptada', async () => {
    const { author, card, exchange } = await setupProposal('request');
    const other = await createUser('uid-otra');
    const second = await prisma.exchange.create({
      data: { cardId: card.id, proposerId: other.id, receiverId: author.id, hours: card.hours },
    });
    await transition(AUTHOR_UID, exchange.id, 'accept');

    const res = await transition(AUTHOR_UID, second.id, 'accept');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'card_unavailable' });
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('proposed');
  });

  it('devuelve 409 card_unavailable si la card ya no está activa', async () => {
    const { card, exchange } = await setupProposal('request');
    await prisma.card.update({ where: { id: card.id }, data: { status: 'completed' } });

    const res = await transition(AUTHOR_UID, exchange.id, 'accept');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'card_unavailable' });
  });

  // wallet.feature — "Saldo insuficiente": en una card request paga la autora y se comprueba al aceptar
  it('devuelve 409 insufficient_balance si la pagadora no tiene saldo disponible suficiente', async () => {
    const { exchange } = await setupProposal('request', { hours: 3, authorHours: 2 });

    const res = await transition(AUTHOR_UID, exchange.id, 'accept');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'insufficient_balance' });
    expect(await getBalance(AUTHOR_UID)).toEqual({ balance: 2, reserved: 0, available: 2 });
  });
});

describe('PATCH /api/exchanges/:id/reject', () => {
  it('la receptora rechaza una propuesta y se guarda rejectedAt', async () => {
    const { exchange } = await setupProposal('request');

    const res = await transition(AUTHOR_UID, exchange.id, 'reject');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', rejectedAt: expect.any(String) });
  });

  it('devuelve 403 si quien rechaza es la proponente', async () => {
    const { exchange } = await setupProposal('request');

    expect((await transition(PROPOSER_UID, exchange.id, 'reject')).status).toBe(403);
  });

  it('devuelve 404 si no participo en el intercambio', async () => {
    const { exchange } = await setupProposal('request');
    await createUser('uid-ajena');

    expect((await transition('uid-ajena', exchange.id, 'reject')).status).toBe(404);
  });

  it('devuelve 409 invalid_transition si la propuesta ya estaba aceptada', async () => {
    const { exchange } = await setupProposal('request');
    await transition(AUTHOR_UID, exchange.id, 'accept');

    const res = await transition(AUTHOR_UID, exchange.id, 'reject');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invalid_transition' });
  });
});

describe('PATCH /api/exchanges/:id/cancel', () => {
  it.each([AUTHOR_UID, PROPOSER_UID])('cualquiera de las dos partes puede cancelar una propuesta (%s)', async (uid) => {
    const { exchange } = await setupProposal('request');

    const res = await transition(uid, exchange.id, 'cancel');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) });
  });

  it.each([
    ['offer', PROPOSER_UID],
    ['request', AUTHOR_UID],
  ] as const)('cancelar un intercambio aceptado en una card %s libera las horas reservadas de la pagadora', async (type, payerUid) => {
    const { exchange } = await setupProposal(type);
    await transition(AUTHOR_UID, exchange.id, 'accept');
    expect((await getBalance(payerUid))?.reserved).toBe(3);

    const res = await transition(PROPOSER_UID, exchange.id, 'cancel');

    expect(res.status).toBe(200);
    expect(await getBalance(payerUid)).toEqual({ balance: 5, reserved: 0, available: 5 });
  });

  it('tras cancelar el intercambio aceptado la card vuelve a estar disponible', async () => {
    const { card, exchange } = await setupProposal('request');
    await transition(AUTHOR_UID, exchange.id, 'accept');
    await transition(AUTHOR_UID, exchange.id, 'cancel');

    const res = await getCardState(PROPOSER_UID, card.id);

    expect(res.body).toEqual({ mine: { id: exchange.id, status: 'cancelled' }, cardAvailable: true });
  });

  it('devuelve 404 si no participo en el intercambio', async () => {
    const { exchange } = await setupProposal('request');
    await createUser('uid-ajena');

    expect((await transition('uid-ajena', exchange.id, 'cancel')).status).toBe(404);
  });

  it.each(['done', 'rejected', 'cancelled'] as const)('devuelve 409 invalid_transition si el intercambio está %s', async (status) => {
    const { exchange } = await setupProposal('request');
    await prisma.exchange.update({ where: { id: exchange.id }, data: { status } });

    const res = await transition(PROPOSER_UID, exchange.id, 'cancel');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invalid_transition' });
  });
});

function confirm(uid: string, exchangeId: string) {
  return request(app).patch(`/api/exchanges/${exchangeId}/confirm`).set('Authorization', `Bearer ${uid}`);
}

async function setupAccepted(type: CardType, options: { hours?: number; authorHours?: number; proposerHours?: number } = {}) {
  const setup = await setupProposal(type, options);
  await transition(AUTHOR_UID, setup.exchange.id, 'accept');
  return setup;
}

describe('PATCH /api/exchanges/:id/confirm', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).patch('/api/exchanges/x/confirm');
    expect(res.status).toBe(401);
  });

  describe('primera confirmación', () => {
    it.each([
      [AUTHOR_UID, 'receiverConfirmedAt', 'proposerConfirmedAt'],
      [PROPOSER_UID, 'proposerConfirmedAt', 'receiverConfirmedAt'],
    ] as const)('%s confirma: el intercambio pasa a done y la card a completed', async (uid, mine, other) => {
      const { card, exchange } = await setupAccepted('request');

      const res = await confirm(uid, exchange.id);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: exchange.id, status: 'done', myConfirmed: true, otherConfirmed: false });
      const stored = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
      expect(stored).toMatchObject({ status: 'done', doneAt: expect.any(Date), [mine]: expect.any(Date), [other]: null, confirmedAt: null });
      expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('completed');
    });

    it.each([
      ['offer', PROPOSER_UID],
      ['request', AUTHOR_UID],
    ] as const)('en una card %s no mueve horas: siguen reservadas a la pagadora y no hay transferencia', async (type, payerUid) => {
      const { exchange } = await setupAccepted(type);

      expect((await confirm(AUTHOR_UID, exchange.id)).status).toBe(200);

      expect(await prisma.timeTransaction.count({ where: { exchangeId: exchange.id } })).toBe(0);
      expect(await getBalance(payerUid)).toEqual({ balance: 5, reserved: 3, available: 2 });
    });

    it.each(['reported', 'deleted'] as const)('no pisa una card %s, pero la confirmación sigue adelante', async (cardStatus) => {
      const { card, exchange } = await setupAccepted('request');
      await prisma.card.update({ where: { id: card.id }, data: { status: cardStatus } });

      const res = await confirm(PROPOSER_UID, exchange.id);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('done');
      expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).status).toBe(cardStatus);
    });
  });

  it('si la misma persona confirma dos veces devuelve 409 already_confirmed y no cambia nada', async () => {
    const { exchange } = await setupAccepted('request');
    await confirm(PROPOSER_UID, exchange.id);
    const before = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });

    const res = await confirm(PROPOSER_UID, exchange.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_confirmed' });
    expect(await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).toEqual(before);
    expect(await prisma.timeTransaction.count({ where: { exchangeId: exchange.id } })).toBe(0);
  });

  it.each(['proposed', 'rejected', 'cancelled'] as const)('devuelve 409 invalid_transition desde %s', async (status) => {
    const { card, exchange } = await setupProposal('request');
    await prisma.exchange.update({ where: { id: exchange.id }, data: { status } });

    const res = await confirm(AUTHOR_UID, exchange.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'invalid_transition' });
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe(status);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).status).toBe('active');
  });

  it('devuelve 404 si no participo en el intercambio o no existe', async () => {
    const { exchange } = await setupAccepted('request');
    await createUser('uid-ajena');

    expect((await confirm('uid-ajena', exchange.id)).status).toBe(404);
    expect((await confirm(AUTHOR_UID, '00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe('accepted');
  });

  // Flujos de la tarjeta 12 cuando la card ya está completed por una confirmación.
  describe('con la card completed tras la primera confirmación', () => {
    async function setupCompletedWithThirdProposal() {
      const setup = await setupAccepted('request');
      const third = await createUser('uid-tercera');
      const thirdProposal = await prisma.exchange.create({
        data: { cardId: setup.card.id, proposerId: third.id, receiverId: setup.author.id, hours: setup.card.hours },
      });
      expect((await confirm(PROPOSER_UID, setup.exchange.id)).status).toBe(200);
      expect((await prisma.card.findUniqueOrThrow({ where: { id: setup.card.id } })).status).toBe('completed');
      return { ...setup, thirdProposal };
    }

    it('el estado de la card la marca no disponible y sigue mostrando mi intercambio', async () => {
      const { card, exchange } = await setupCompletedWithThirdProposal();

      expect((await getCardState(PROPOSER_UID, card.id)).body).toEqual({
        mine: { id: exchange.id, status: 'done' },
        cardAvailable: false,
      });
      expect((await getCardState('uid-tercera', card.id)).body).toEqual({
        mine: { id: expect.any(String), status: 'proposed' },
        cardAvailable: false,
      });
    });

    it('nadie puede proponer de nuevo: 409 card_unavailable', async () => {
      const { card } = await setupCompletedWithThirdProposal();
      await createUser('uid-nueva');

      const res = await propose('uid-nueva', { cardId: card.id });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'card_unavailable' });
    });

    it('la propuesta de una tercera persona sigue proposed: no se puede aceptar, pero sí rechazar o cancelar', async () => {
      const { thirdProposal } = await setupCompletedWithThirdProposal();

      const detail = await request(app).get(`/api/exchanges/${thirdProposal.id}`).set('Authorization', `Bearer ${AUTHOR_UID}`);
      expect(detail.body.actions).toEqual(['reject', 'cancel']);

      const accept = await transition(AUTHOR_UID, thirdProposal.id, 'accept');
      expect(accept.status).toBe(409);
      expect(accept.body).toEqual({ error: 'card_unavailable' });

      expect((await transition(AUTHOR_UID, thirdProposal.id, 'reject')).body.status).toBe('rejected');
    });

    it('el intercambio en done no se puede cancelar', async () => {
      const { exchange } = await setupCompletedWithThirdProposal();

      const res = await transition(AUTHOR_UID, exchange.id, 'cancel');

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'invalid_transition' });
    });
  });
});

describe('PATCH /api/exchanges/:id/confirm — segunda confirmación', () => {
  // La autora confirma primero y la proponente completa; el orden contrario tiene su propio test.
  async function setupDone(type: CardType, options: { hours?: number; authorHours?: number; proposerHours?: number } = {}) {
    const setup = await setupAccepted(type, options);
    expect((await confirm(AUTHOR_UID, setup.exchange.id)).status).toBe(200);
    return setup;
  }

  function transfersOf(exchangeId: string) {
    return prisma.timeTransaction.findMany({ where: { exchangeId } });
  }

  it.each([
    ['offer', 'proposer', 'author'],
    ['request', 'author', 'proposer'],
  ] as const)('en una card %s pasa a confirmed y crea una única transferencia de %s a %s', async (type, payer, payee) => {
    const setup = await setupDone(type);

    const res = await confirm(PROPOSER_UID, setup.exchange.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: setup.exchange.id, status: 'confirmed', myConfirmed: true, otherConfirmed: true, actions: [] });
    expect(await prisma.exchange.findUniqueOrThrow({ where: { id: setup.exchange.id } })).toMatchObject({
      status: 'confirmed',
      confirmedAt: expect.any(Date),
      proposerConfirmedAt: expect.any(Date),
      receiverConfirmedAt: expect.any(Date),
    });
    expect(await transfersOf(setup.exchange.id)).toEqual([
      expect.objectContaining({ type: 'transfer', fromUserId: setup[payer].id, toUserId: setup[payee].id, hours: 3 }),
    ]);
  });

  it('completa igual si la primera en confirmar fue la proponente', async () => {
    const { exchange } = await setupAccepted('request');
    await confirm(PROPOSER_UID, exchange.id);

    const res = await confirm(AUTHOR_UID, exchange.id);

    expect(res.body.status).toBe('confirmed');
    expect(await transfersOf(exchange.id)).toHaveLength(1);
  });

  it('transfiere las horas del intercambio, no las de la card', async () => {
    const { card, exchange } = await setupDone('request');
    await prisma.card.update({ where: { id: card.id }, data: { hours: 7 } });

    await confirm(PROPOSER_UID, exchange.id);

    expect((await transfersOf(exchange.id))[0].hours).toBe(3);
  });

  it.each([
    ['offer', PROPOSER_UID, AUTHOR_UID],
    ['request', AUTHOR_UID, PROPOSER_UID],
  ] as const)('en una card %s la pagadora conserva el disponible, deja de reservar y la otra persona cobra', async (type, payerUid, payeeUid) => {
    const { exchange } = await setupDone(type);
    expect(await getBalance(payerUid)).toEqual({ balance: 5, reserved: 3, available: 2 });

    await confirm(PROPOSER_UID, exchange.id);

    expect(await getBalance(payerUid)).toEqual({ balance: 2, reserved: 0, available: 2 });
    expect(await getBalance(payeeUid)).toEqual({ balance: 8, reserved: 0, available: 8 });
  });

  it.each([
    ['offer', { proposerHours: 3 }, PROPOSER_UID],
    ['request', { authorHours: 3 }, AUTHOR_UID],
  ] as const)('en una card %s, una pagadora con justo las horas del intercambio acaba en 0, nunca en negativo', async (type, hours, payerUid) => {
    const { exchange } = await setupDone(type, { hours: 3, ...hours });
    expect(await getBalance(payerUid)).toEqual({ balance: 3, reserved: 3, available: 0 });

    await confirm(PROPOSER_UID, exchange.id);

    expect(await getBalance(payerUid)).toEqual({ balance: 0, reserved: 0, available: 0 });
  });

  it.each(['completed', 'reported', 'deleted'] as const)('completa aunque la card esté %s', async (cardStatus) => {
    const { card, exchange } = await setupDone('request');
    await prisma.card.update({ where: { id: card.id }, data: { status: cardStatus } });

    const res = await confirm(PROPOSER_UID, exchange.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(await transfersOf(exchange.id)).toHaveLength(1);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).status).toBe(cardStatus);
  });

  it.each([AUTHOR_UID, PROPOSER_UID])('confirmar otra vez un intercambio confirmed devuelve 409 a %s y no crea filas', async (uid) => {
    const { exchange } = await setupDone('request');
    await confirm(PROPOSER_UID, exchange.id);

    const res = await confirm(uid, exchange.id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_confirmed' });
    expect(await transfersOf(exchange.id)).toHaveLength(1);
  });

  it('una tercera persona recibe 404 y el intercambio no avanza', async () => {
    const { exchange } = await setupDone('request');
    await createUser('uid-ajena');

    expect((await confirm('uid-ajena', exchange.id)).status).toBe(404);
    expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe('done');
    expect(await transfersOf(exchange.id)).toHaveLength(0);
  });

  // Defensa extra: con el bloqueo de la card no debería pasar nunca. Si pasa, es un fallo interno, no del usuario.
  it('si ya existe una transferencia para el intercambio aborta con 500 y no cambia nada', async () => {
    const { author, proposer, exchange } = await setupDone('request');
    await prisma.timeTransaction.create({
      data: { type: 'transfer', fromUserId: author.id, toUserId: proposer.id, hours: 3, exchangeId: exchange.id },
    });
    const before = await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await confirm(PROPOSER_UID, exchange.id);
    consoleError.mockRestore();

    expect(res.status).toBe(500);
    expect(await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).toEqual(before);
    expect(await transfersOf(exchange.id)).toHaveLength(1);
  });
});
