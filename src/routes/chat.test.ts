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

function sendMessage(uid: string, exchangeId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/exchanges/${exchangeId}/messages`).set('Authorization', `Bearer ${uid}`).send(body);
}

describe('POST /api/exchanges/:id/messages', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/exchanges/x/messages').send({ text: 'Hola' });
    expect(res.status).toBe(401);
  });

  // chat.feature — "Enviar y recibir mensajes dentro del chat de un intercambio"
  it('una participante envía un mensaje, se guarda y la otra lo ve al abrir el chat', async () => {
    const { proposer, exchange } = await setupExchange();

    const res = await sendMessage(PROPOSER_UID, exchange.id, { text: '¿Te va bien el sábado a las 10?' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), text: '¿Te va bien el sábado a las 10?', sentAt: expect.any(String), mine: true });
    expect(await prisma.message.findUniqueOrThrow({ where: { id: res.body.id } })).toMatchObject({
      exchangeId: exchange.id,
      senderId: proposer.id,
      text: '¿Te va bien el sábado a las 10?',
    });

    const list = await getMessages(AUTHOR_UID, exchange.id);
    expect(list.body).toEqual([{ ...res.body, mine: false }]);
  });

  it('recorta los espacios del texto antes de guardarlo', async () => {
    const { exchange } = await setupExchange();

    const res = await sendMessage(AUTHOR_UID, exchange.id, { text: '   Hola   ' });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe('Hola');
  });

  it('acepta un texto de exactamente 2000 caracteres', async () => {
    const { exchange } = await setupExchange();

    const res = await sendMessage(AUTHOR_UID, exchange.id, { text: 'a'.repeat(2000) });

    expect(res.status).toBe(201);
  });

  it.each(['proposed', 'accepted', 'done'] as const)('se puede escribir con el intercambio %s', async (status) => {
    const { exchange } = await setupExchange({ status });

    for (const uid of [AUTHOR_UID, PROPOSER_UID]) {
      expect((await sendMessage(uid, exchange.id, { text: 'Hola' })).status).toBe(201);
    }
  });

  it.each(['cancelled', 'rejected', 'confirmed', 'rated'] as const)(
    'con el intercambio %s devuelve 409 chat_closed, no guarda nada y el chat se sigue leyendo',
    async (status) => {
      const { proposer, exchange } = await setupExchange({ status });
      await prisma.message.create({ data: { exchangeId: exchange.id, senderId: proposer.id, text: 'Gracias' } });

      const res = await sendMessage(AUTHOR_UID, exchange.id, { text: 'Hola' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: 'chat_closed' });
      expect(await prisma.message.count()).toBe(1);
      expect((await getMessages(AUTHOR_UID, exchange.id)).body).toHaveLength(1);
    },
  );

  it.each([
    ['sin text', {}],
    ['con text que no es un texto', { text: 42 }],
    ['con text vacío', { text: '' }],
    ['con text de solo espacios', { text: '   \n\t ' }],
    ['con text de más de 2000 caracteres', { text: 'a'.repeat(2001) }],
  ])('devuelve 400 %s y no guarda nada', async (_case, body) => {
    const { exchange } = await setupExchange();

    const res = await sendMessage(AUTHOR_UID, exchange.id, body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await prisma.message.count()).toBe(0);
  });

  it('comprueba el texto antes que el estado: texto inválido en un chat cerrado da 400', async () => {
    const { exchange } = await setupExchange({ status: 'confirmed' });

    const res = await sendMessage(AUTHOR_UID, exchange.id, { text: '   ' });

    expect(res.status).toBe(400);
  });

  // chat.feature — "El chat solo es visible para las dos personas implicadas"
  it('a una tercera persona le responde igual que si el intercambio no existiera, sea cual sea el estado o el texto', async () => {
    const { exchange: open } = await setupExchange();
    const closed = await prisma.exchange.create({
      data: { cardId: open.cardId, proposerId: open.proposerId, receiverId: open.receiverId, hours: 3, status: 'confirmed' },
    });
    const missing = await sendMessage(AUTHOR_UID, MISSING_ID, { text: 'Hola' });

    for (const [id, body] of [
      [open.id, { text: 'Hola' }],
      [open.id, { text: '' }],
      [closed.id, { text: 'Hola' }],
      [closed.id, { text: 'a'.repeat(2001) }],
    ] as const) {
      const res = await sendMessage(OUTSIDER_UID, id, body);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(missing.body);
    }
    expect(missing.status).toBe(404);
    expect(await prisma.message.count()).toBe(0);
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const { exchange } = await setupExchange();

    const res = await sendMessage('uid-sin-registro', exchange.id, { text: 'Hola' });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });
});

// chat.feature — "El teléfono no se comparte por defecto"
describe('privacidad del chat', () => {
  const CONTACT_KEY = /mail|phone|tel[eé]fono|m[oó]vil|mobile|whatsapp/i;

  // Recorre todo el JSON: cualquier campo nuevo que se cuele en un select, por anidado que esté, sale aquí.
  function collectEntries(value: unknown, path = '$'): { path: string; key?: string; value: unknown }[] {
    if (Array.isArray(value)) return value.flatMap((item, i) => collectEntries(item, `${path}[${i}]`));
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, child]) => [
        { path: `${path}.${key}`, key, value: child },
        ...collectEntries(child, `${path}.${key}`),
      ]);
    }
    return [{ path, value }];
  }

  // Todas las rutas del chat; las de confirmar y denunciar se añaden aquí cuando existan.
  const CHAT_ROUTES: [string, (uid: string, exchangeId: string) => request.Test][] = [
    ['GET /:id', (uid, id) => getDetail(uid, id)],
    ['GET /:id/messages', (uid, id) => getMessages(uid, id)],
    ['POST /:id/messages', (uid, id) => sendMessage(uid, id, { text: 'Nos vemos el sábado' })],
  ];

  it.each(CHAT_ROUTES)('%s no expone datos de contacto a ninguna de las dos personas', async (_route, call) => {
    const { author, proposer, exchange } = await setupExchange({ status: 'accepted' });
    await prisma.message.create({ data: { exchangeId: exchange.id, senderId: author.id, text: 'Hola' } });
    const emails = [author.email, proposer.email];

    for (const uid of [AUTHOR_UID, PROPOSER_UID]) {
      const res = await call(uid, exchange.id);
      expect(res.status).toBeLessThan(300);

      const entries = collectEntries(res.body);
      expect(entries.filter(({ key }) => key !== undefined && CONTACT_KEY.test(key)).map(({ path }) => path)).toEqual([]);
      expect(
        entries
          .filter(({ value }) => typeof value === 'string' && emails.some((email) => value.includes(email)))
          .map(({ path }) => path),
      ).toEqual([]);
    }
  });
});
