import { prisma } from '../config/prisma';
import { transitionExchange } from './exchangeService';
import { getBalance } from './walletService';

async function createUser(firebaseUid: string, hours = 0) {
  const user = await prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
  if (hours > 0) await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: user.id, hours } });
  return user;
}

async function createRequestWithProposal(authorId: string, proposerId: string, hours: number) {
  const card = await prisma.card.create({
    data: { authorId, type: 'request', hours, title: 'Card', description: 'Desc', category: 'garden' },
  });
  return prisma.exchange.create({ data: { cardId: card.id, proposerId, receiverId: authorId, hours } });
}

describe('exchangeService — aceptaciones simultáneas', () => {
  it('dos aceptaciones a la vez de propuestas sobre la misma card: solo una gana', async () => {
    const author = await createUser('uid-autora', 10);
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const first = await createRequestWithProposal(author.id, ana.id, 2);
    const second = await prisma.exchange.create({
      data: { cardId: first.cardId, proposerId: bea.id, receiverId: author.id, hours: 2 },
    });

    const results = await Promise.all([
      transitionExchange('uid-autora', first.id, 'accept'),
      transitionExchange('uid-autora', second.id, 'accept'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'card-unavailable' });
    expect(await prisma.exchange.count({ where: { status: 'accepted' } })).toBe(1);
    expect((await getBalance('uid-autora'))?.reserved).toBe(2);
  });

  it('dos aceptaciones a la vez en cards distintas cuando el saldo solo cubre una: solo una gana', async () => {
    const author = await createUser('uid-autora', 3);
    const ana = await createUser('uid-ana');
    const bea = await createUser('uid-bea');
    const first = await createRequestWithProposal(author.id, ana.id, 3);
    const second = await createRequestWithProposal(author.id, bea.id, 3);

    const results = await Promise.all([
      transitionExchange('uid-autora', first.id, 'accept'),
      transitionExchange('uid-autora', second.id, 'accept'),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'insufficient-balance' });
    expect(await getBalance('uid-autora')).toEqual({ balance: 3, reserved: 3, available: 0 });
  });
});
