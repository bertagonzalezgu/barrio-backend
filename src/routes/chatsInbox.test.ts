import request from 'supertest';
import { prisma } from '../config/prisma';
import type { CardStatus, CardType, ExchangeStatus } from '../generated/prisma/client';

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
