import { prisma } from '../config/prisma';
import { confirmExchange, transitionExchange } from './exchangeService';
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

describe('exchangeService — confirmaciones simultáneas', () => {
  // Cada ronda con sus propias usuarias, para repetir la carrera varias veces en el mismo test.
  async function setupAcceptedRound(round: number) {
    const author = await createUser(`uid-autora-${round}`, 5);
    const proposer = await createUser(`uid-proponente-${round}`);
    const exchange = await createRequestWithProposal(author.id, proposer.id, 3);
    await prisma.exchange.update({ where: { id: exchange.id }, data: { status: 'accepted', acceptedAt: new Date() } });
    return { author, proposer, exchange };
  }

  it('las dos personas confirman a la vez desde accepted: acaba confirmed con una sola transferencia', async () => {
    for (let round = 0; round < 5; round++) {
      const { author, proposer, exchange } = await setupAcceptedRound(round);

      const results = await Promise.all([
        confirmExchange(author.firebaseUid, exchange.id),
        confirmExchange(proposer.firebaseUid, exchange.id),
      ]);

      expect(results.every((r) => r.ok)).toBe(true);
      expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe('confirmed');
      expect(await prisma.timeTransaction.count({ where: { exchangeId: exchange.id } })).toBe(1);
      expect(await getBalance(author.firebaseUid)).toEqual({ balance: 2, reserved: 0, available: 2 });
    }
  });

  it('la misma persona confirma dos veces a la vez: una gana, la otra recibe already-confirmed y no hay transferencia', async () => {
    for (let round = 0; round < 5; round++) {
      const { proposer, exchange } = await setupAcceptedRound(round);

      const results = await Promise.all([
        confirmExchange(proposer.firebaseUid, exchange.id),
        confirmExchange(proposer.firebaseUid, exchange.id),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'already-confirmed' });
      expect((await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).status).toBe('done');
      expect(await prisma.timeTransaction.count({ where: { exchangeId: exchange.id } })).toBe(0);
    }
  });
});
