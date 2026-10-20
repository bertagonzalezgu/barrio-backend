import request from 'supertest';
import { prisma } from '../config/prisma';
import { grantWelcomeCredit } from '../services/walletService';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

describe('GET /api/wallet/balance', () => {
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/wallet/balance');
    expect(res.status).toBe(401);
  });

  it('devuelve el saldo del usuario autenticado', async () => {
    const ana = await prisma.user.create({ data: { firebaseUid: 'uid-ana', name: 'Ana', email: 'ana@barrio.local' } });
    const otra = await prisma.user.create({ data: { firebaseUid: 'uid-otra', name: 'Otra', email: 'otra@barrio.local' } });
    await prisma.timeTransaction.createMany({
      data: [
        { type: 'transfer', toUserId: ana.id, hours: 5 },
        { type: 'transfer', toUserId: otra.id, hours: 9 },
      ],
    });
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-ana' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ balance: 5, reserved: 0, available: 5 });
  });

  it('devuelve 404 si el usuario de Firebase no está registrado en la base de datos', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-sin-registro' } as never);

    const res = await request(app)
      .get('/api/wallet/balance')
      .set('Authorization', 'Bearer token-valido');

    expect(res.status).toBe(404);
  });
});

// perfil.feature — "Ver mi perfil con historial de créditos"
describe('GET /api/wallet/transactions', () => {
  // El token es el propio uid, como en los tests del chat.
  beforeEach(() => {
    mockVerifyIdToken.mockReset();
    mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
  });

  function getTransactions(uid: string) {
    return request(app).get('/api/wallet/transactions').set('Authorization', `Bearer ${uid}`);
  }

  function createUser(firebaseUid: string, name = firebaseUid) {
    return prisma.user.create({ data: { firebaseUid, name, email: `${firebaseUid}@barrio.local` } });
  }

  // Un intercambio confirmado sobre una card de `authorId` con su transferencia de `fromUserId` a `toUserId`.
  async function createTransfer(
    authorId: string,
    proposerId: string,
    { fromUserId, toUserId, date, title = 'Clases de guitarra' }: { fromUserId: string; toUserId: string; date: Date; title?: string },
  ) {
    const card = await prisma.card.create({
      data: { authorId, type: 'offer', hours: 2, status: 'completed', title, description: 'Desc', category: 'learning' },
    });
    const exchange = await prisma.exchange.create({
      data: { cardId: card.id, proposerId, receiverId: authorId, hours: 2, status: 'confirmed' },
    });
    const transaction = await prisma.timeTransaction.create({
      data: { type: 'transfer', exchangeId: exchange.id, fromUserId, toUserId, hours: 2, date },
    });
    return { card, exchange, transaction };
  }

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/wallet/transactions');
    expect(res.status).toBe(401);
  });

  it('devuelve 404 si la usuaria no está registrada', async () => {
    const res = await getTransactions('uid-sin-registro');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Usuario no registrado' });
  });

  it('sin movimientos devuelve una lista vacía', async () => {
    await createUser('uid-ana');

    const res = await getTransactions('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('con solo el regalo de bienvenida devuelve una entrada welcome sin card ni otra persona', async () => {
    const ana = await createUser('uid-ana');
    await grantWelcomeCredit(ana.id);
    const welcome = await prisma.timeTransaction.findFirstOrThrow({ where: { toUserId: ana.id } });

    const res = await getTransactions('uid-ana');

    expect(res.body).toEqual({
      items: [
        {
          id: welcome.id,
          kind: 'welcome',
          direction: 'in',
          hours: 2,
          date: welcome.date.toISOString(),
          exchangeId: null,
          card: null,
          other: null,
        },
      ],
    });
  });

  it('incluye una transferencia entrante y una saliente con su card y la otra persona, de la más reciente a la más antigua', async () => {
    const ana = await createUser('uid-ana', 'Ana');
    const javi = await createUser('uid-javi', 'Javi');
    await prisma.user.update({ where: { id: javi.id }, data: { avatar: 'avatar-05' } });
    await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: ana.id, hours: 2, date: new Date('2026-09-29T15:27:03Z') } });
    // Ana da clases de guitarra a Javi y cobra; después Javi le arregla la bici y Ana paga.
    const incoming = await createTransfer(ana.id, javi.id, { fromUserId: javi.id, toUserId: ana.id, date: new Date('2026-10-12T10:30:00Z') });
    const outgoing = await createTransfer(javi.id, ana.id, {
      fromUserId: ana.id,
      toUserId: javi.id,
      date: new Date('2026-10-15T18:00:00Z'),
      title: 'Arreglo bicis',
    });

    const res = await getTransactions('uid-ana');

    expect(res.status).toBe(200);
    expect(res.body.items.map(({ kind, direction }: { kind: string; direction: string }) => [kind, direction])).toEqual([
      ['exchange', 'out'],
      ['exchange', 'in'],
      ['welcome', 'in'],
    ]);
    expect(res.body.items[0]).toEqual({
      id: outgoing.transaction.id,
      kind: 'exchange',
      direction: 'out',
      hours: 2,
      date: '2026-10-15T18:00:00.000Z',
      exchangeId: outgoing.exchange.id,
      card: { id: outgoing.card.id, title: 'Arreglo bicis', type: 'offer', category: 'learning' },
      other: { id: javi.id, name: 'Javi', avatar: 'avatar-05' },
    });
    expect(res.body.items[1]).toMatchObject({
      id: incoming.transaction.id,
      direction: 'in',
      exchangeId: incoming.exchange.id,
      card: { id: incoming.card.id, title: 'Clases de guitarra' },
      other: { id: javi.id, name: 'Javi', avatar: 'avatar-05' },
    });
  });

  it('la otra persona ve la misma transferencia en sentido contrario', async () => {
    const ana = await createUser('uid-ana', 'Ana');
    const javi = await createUser('uid-javi', 'Javi');
    await createTransfer(ana.id, javi.id, { fromUserId: javi.id, toUserId: ana.id, date: new Date('2026-10-12T10:30:00Z') });

    const res = await getTransactions('uid-javi');

    expect(res.body.items).toEqual([expect.objectContaining({ direction: 'out', other: { id: ana.id, name: 'Ana', avatar: '' } })]);
  });

  it('con la misma fecha desempata por id ascendente', async () => {
    const ana = await createUser('uid-ana');
    const date = new Date('2026-10-01T10:00:00Z');
    await prisma.timeTransaction.createMany({
      data: [1, 2, 3].map(() => ({ type: 'transfer' as const, toUserId: ana.id, hours: 1, date })),
    });

    const ids: string[] = (await getTransactions('uid-ana')).body.items.map(({ id }: { id: string }) => id);

    expect(ids).toHaveLength(3);
    expect(ids).toEqual([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('una card borrada sigue saliendo en el historial', async () => {
    const ana = await createUser('uid-ana');
    const javi = await createUser('uid-javi');
    const { card } = await createTransfer(ana.id, javi.id, { fromUserId: javi.id, toUserId: ana.id, date: new Date() });
    await prisma.card.update({ where: { id: card.id }, data: { status: 'deleted' } });

    const res = await getTransactions('uid-ana');

    expect(res.body.items[0].card).toMatchObject({ id: card.id, title: 'Clases de guitarra' });
  });

  it('no incluye movimientos de otras usuarias', async () => {
    const ana = await createUser('uid-ana');
    const javi = await createUser('uid-javi');
    const otra = await createUser('uid-otra');
    await grantWelcomeCredit(ana.id);
    await grantWelcomeCredit(javi.id);
    await createTransfer(javi.id, otra.id, { fromUserId: otra.id, toUserId: javi.id, date: new Date() });

    const res = await getTransactions('uid-ana');

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].kind).toBe('welcome');
  });

  it('devuelve como mucho las 100 más recientes', async () => {
    const ana = await createUser('uid-ana');
    const minute = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000);
    await prisma.timeTransaction.createMany({
      data: Array.from({ length: 101 }, (_, i) => ({ type: 'transfer' as const, toUserId: ana.id, hours: 1, date: minute(i) })),
    });

    const { items } = (await getTransactions('uid-ana')).body;

    expect(items).toHaveLength(100);
    expect(items[0].date).toBe(minute(100).toISOString());
    expect(items.at(-1).date).toBe(minute(1).toISOString());
  });

  // Como en el chat: se recorre todo el JSON, así que cualquier campo que se cuele en un select sale aquí.
  it('no expone email ni firebaseUid de nadie en ninguna parte del JSON', async () => {
    // Nombres propios: con el nombre por defecto (el uid) el test confundiría el nombre con el firebaseUid.
    const ana = await createUser('uid-ana', 'Ana');
    const javi = await createUser('uid-javi', 'Javi');
    await grantWelcomeCredit(ana.id);
    await createTransfer(ana.id, javi.id, { fromUserId: javi.id, toUserId: ana.id, date: new Date() });
    await createTransfer(javi.id, ana.id, { fromUserId: ana.id, toUserId: javi.id, date: new Date() });

    const json = JSON.stringify((await getTransactions('uid-ana')).body);

    for (const leak of ['"email"', '"firebaseUid"', 'uid-ana', 'uid-javi', '@barrio.local', 'welcomeCredit']) {
      expect(json).not.toContain(leak);
    }
  });
});
