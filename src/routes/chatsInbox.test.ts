import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus, CardType, ExchangeStatus } from '../generated/prisma/client';
import { listMyChats } from '../services/chatService';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

// El token es el propio uid, como en el resto de tests de exchanges.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

interface ExchangeOptions {
  type?: CardType;
  cardStatus?: CardStatus;
  status?: ExchangeStatus;
  title?: string;
}

// Una card de `authorId` con una propuesta de `proposerId`: la autora es la receptora.
async function createExchange(authorId: string, proposerId: string, options: ExchangeOptions = {}) {
  const { type = 'request', cardStatus = 'active', status = 'proposed', title = 'Regar plantas' } = options;
  const card = await prisma.card.create({
    data: { authorId, type, hours: 3, status: cardStatus, title, description: 'Desc', category: 'garden' },
  });
  const exchange = await prisma.exchange.create({ data: { cardId: card.id, proposerId, receiverId: authorId, hours: 3, status } });
  return { card, exchange };
}

function getChats(uid: string) {
  return request(app).get('/api/exchanges').set('Authorization', `Bearer ${uid}`);
}

describe('GET /api/exchanges', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/exchanges');
    expect(res.status).toBe(401);
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const res = await getChats('uid-sin-registro');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  it('devuelve [] a quien no tiene intercambios, aunque otras personas sí los tengan', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    await createUser('uid-sola');
    await createExchange(ana.id, bea.id);

    const res = await getChats('uid-sola');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('devuelve los intercambios donde soy receptora y donde soy proponente, y no los de otras dos personas', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const carla = await createUser('uid-carla');
    const asReceiver = await createExchange(ana.id, bea.id);
    const asProposer = await createExchange(carla.id, ana.id);
    await createExchange(bea.id, carla.id);

    const res = await getChats('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body.map((chat: { id: string }) => chat.id).sort()).toEqual([asReceiver.exchange.id, asProposer.exchange.id].sort());
  });

  it('cada intercambio trae su estado, horas, fecha de propuesta, la card y solo id, nombre y avatar de la otra persona', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const { card, exchange } = await createExchange(ana.id, bea.id, { type: 'offer', status: 'accepted' });

    const res = await getChats('uid-ana');

    expect(res.body).toEqual([
      expect.objectContaining({
        id: exchange.id,
        status: 'accepted',
        hours: 3,
        proposedAt: exchange.proposedAt.toISOString(),
        card: { id: card.id, title: 'Regar plantas', type: 'offer' },
        other: { id: bea.id, name: 'uid-bea', avatar: '' },
      }),
    ]);
  });

  it.each([
    ['uid-ana', 'bea'],
    ['uid-bea', 'ana'],
  ] as const)('para %s, other es la otra persona del intercambio', async (uid, otherKey) => {
    const people = { ana: await createUser('uid-ana'), bea: await createUser('uid-bea') };
    await createExchange(people.ana.id, people.bea.id);

    const res = await getChats(uid);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].other).toEqual({ id: people[otherKey].id, name: people[otherKey].name, avatar: '' });
  });

  it('devuelve los intercambios en todos los estados, también con la card deleted o reported', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const statuses: ExchangeStatus[] = ['proposed', 'accepted', 'done', 'confirmed', 'rated', 'cancelled', 'rejected'];
    for (const status of statuses) await createExchange(ana.id, bea.id, { status });
    const deleted = await createExchange(ana.id, bea.id, { cardStatus: 'deleted', title: 'Card borrada' });
    const reported = await createExchange(bea.id, ana.id, { cardStatus: 'reported', title: 'Card denunciada' });

    const res = await getChats('uid-ana');

    expect(res.body).toHaveLength(statuses.length + 2);
    expect(res.body.map((chat: { status: ExchangeStatus }) => chat.status).sort()).toEqual([...statuses, 'proposed', 'proposed'].sort());
    const titles = Object.fromEntries(res.body.map((chat: { id: string; card: { title: string } }) => [chat.id, chat.card.title]));
    expect(titles[deleted.exchange.id]).toBe('Card borrada');
    expect(titles[reported.exchange.id]).toBe('Card denunciada');
  });
});

// Fechas fijas para que el orden no dependa del reloj ni de cuánto tarda cada inserción.
const T1 = new Date('2026-10-01T10:00:00.000Z');
const T2 = new Date('2026-10-02T10:00:00.000Z');
const T3 = new Date('2026-10-03T10:00:00.000Z');

// updatedAt lo pone Prisma al actualizar; aquí se fija a mano para simular "la última vez que cambió el estado".
function setUpdatedAt(exchangeId: string, at: Date) {
  return prisma.$executeRaw`UPDATE "Exchange" SET "updatedAt" = ${at} WHERE id = ${exchangeId}`;
}

function createMessage(exchangeId: string, senderId: string, text: string, sentAt: Date) {
  return prisma.message.create({ data: { exchangeId, senderId, text, sentAt } });
}

describe('GET /api/exchanges — último mensaje y actividad', () => {
  it('lastMessage es el mensaje más reciente, con mine según quién pregunta y sin senderId', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const { exchange } = await createExchange(ana.id, bea.id);
    await createMessage(exchange.id, ana.id, '¿Quedamos el sábado?', T1);
    await createMessage(exchange.id, bea.id, 'El sábado me va bien', T2);

    const asAna = await getChats('uid-ana');
    const asBea = await getChats('uid-bea');

    expect(asAna.body[0].lastMessage).toEqual({ text: 'El sábado me va bien', sentAt: T2.toISOString(), mine: false });
    expect(asBea.body[0].lastMessage).toEqual({ text: 'El sábado me va bien', sentAt: T2.toISOString(), mine: true });
  });

  it('lastMessage es null si el intercambio no tiene mensajes, y lastActivityAt es su updatedAt', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const { exchange } = await createExchange(ana.id, bea.id);
    await setUpdatedAt(exchange.id, T1);

    const res = await getChats('uid-ana');

    expect(res.body[0]).toMatchObject({ lastMessage: null, lastActivityAt: T1.toISOString() });
  });

  it('cada intercambio trae su propio último mensaje', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const first = await createExchange(ana.id, bea.id);
    const second = await createExchange(bea.id, ana.id);
    await createMessage(first.exchange.id, bea.id, 'Mensaje del primero', T1);
    await createMessage(second.exchange.id, ana.id, 'Viejo del segundo', T1);
    await createMessage(second.exchange.id, bea.id, 'Nuevo del segundo', T3);

    const res = await getChats('uid-ana');

    const lastTexts = Object.fromEntries(res.body.map((chat: { id: string; lastMessage: { text: string } }) => [chat.id, chat.lastMessage.text]));
    expect(lastTexts).toEqual({ [first.exchange.id]: 'Mensaje del primero', [second.exchange.id]: 'Nuevo del segundo' });
  });

  it.each([
    ['el mensaje es posterior al último cambio', T1, T2, T2],
    ['el último cambio es posterior al mensaje', T3, T2, T3],
  ])('lastActivityAt es el más reciente de updatedAt y el último mensaje cuando %s', async (_case, updatedAt, sentAt, expected) => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const { exchange } = await createExchange(ana.id, bea.id);
    await createMessage(exchange.id, bea.id, 'Hola', sentAt);
    await setUpdatedAt(exchange.id, updatedAt);

    const res = await getChats('uid-ana');

    expect(res.body[0].lastActivityAt).toBe(expected.toISOString());
  });

  it('un mensaje nuevo sube un intercambio por encima de otro con un cambio de estado más reciente', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const quiet = await createExchange(ana.id, bea.id);
    const talked = await createExchange(bea.id, ana.id);
    await setUpdatedAt(quiet.exchange.id, T2);
    await setUpdatedAt(talked.exchange.id, T1);
    await createMessage(talked.exchange.id, bea.id, '¿Sigue en pie?', T3);

    const res = await getChats('uid-ana');

    expect(res.body.map((chat: { id: string }) => chat.id)).toEqual([talked.exchange.id, quiet.exchange.id]);
  });

  it('un cambio de estado sube un intercambio aunque no tenga mensajes nuevos', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const cancelled = await createExchange(ana.id, bea.id);
    const chatted = await createExchange(bea.id, ana.id);
    await setUpdatedAt(cancelled.exchange.id, T1);
    await setUpdatedAt(chatted.exchange.id, T1);
    await createMessage(chatted.exchange.id, ana.id, 'Hola', T2);

    // Un cambio de estado real: Prisma pone updatedAt al momento actual, posterior a T2.
    const cancel = await request(app).patch(`/api/exchanges/${cancelled.exchange.id}/cancel`).set('Authorization', 'Bearer uid-bea');
    expect(cancel.status).toBe(200);

    const res = await getChats('uid-ana');

    expect(res.body.map((chat: { id: string }) => chat.id)).toEqual([cancelled.exchange.id, chatted.exchange.id]);
  });

  it('con la misma actividad, el orden lo decide el id', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { exchange } = await createExchange(ana.id, bea.id);
      await setUpdatedAt(exchange.id, T1);
      ids.push(exchange.id);
    }

    const res = await getChats('uid-ana');

    expect(res.body.map((chat: { id: string }) => chat.id)).toEqual([...ids].sort());
  });
});

// La consulta del último mensaje es SQL crudo: el cálculo de lastActivityAt depende de que sentAt llegue como Date.
describe('listMyChats', () => {
  it('devuelve sentAt y lastActivityAt como Date', async () => {
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const { exchange } = await createExchange(ana.id, bea.id);
    await createMessage(exchange.id, bea.id, 'Hola', T2);

    const result = await listMyChats('uid-ana');

    if (!result.ok) throw new Error('listMyChats debería encontrar a la usuaria');
    expect(result.chats[0].lastMessage?.sentAt).toBeInstanceOf(Date);
    expect(result.chats[0].lastActivityAt).toBeInstanceOf(Date);
  });
});
