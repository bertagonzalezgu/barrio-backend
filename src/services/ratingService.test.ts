import { prisma } from '../config/prisma';
import type { Prisma } from '../generated/prisma/client';
import { rateExchange } from './ratingService';

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

// Cada ronda con sus propias usuarias, para repetir la carrera varias veces en el mismo test.
async function setupConfirmedRound(round: number) {
  const author = await createUser(`uid-autora-${round}`);
  const proposer = await createUser(`uid-proponente-${round}`);
  const card = await prisma.card.create({
    data: { authorId: author.id, type: 'request', hours: 3, status: 'completed', title: 'Card', description: 'Desc', category: 'garden' },
  });
  const now = new Date();
  const exchange = await prisma.exchange.create({
    data: {
      cardId: card.id,
      proposerId: proposer.id,
      receiverId: author.id,
      hours: 3,
      status: 'confirmed',
      confirmedAt: now,
      proposerConfirmedAt: now,
      receiverConfirmedAt: now,
    },
  });
  return { author, proposer, exchange };
}

describe('ratingService — valoraciones simultáneas', () => {
  // Sin el bloqueo de la card, cada transacción contaría solo su propia valoración y ninguna marcaría rated.
  it('las dos personas valoran a la vez: acaba rated con las dos valoraciones', async () => {
    for (let round = 0; round < 5; round++) {
      const { author, proposer, exchange } = await setupConfirmedRound(round);

      const results = await Promise.all([
        rateExchange(author.firebaseUid, exchange.id, { score: 4 }),
        rateExchange(proposer.firebaseUid, exchange.id, { score: 5 }),
      ]);

      expect(results.every((r) => r.ok)).toBe(true);
      expect(await prisma.exchange.findUniqueOrThrow({ where: { id: exchange.id } })).toMatchObject({
        status: 'rated',
        ratedAt: expect.any(Date),
      });
      expect(await prisma.rating.count({ where: { exchangeId: exchange.id } })).toBe(2);
    }
  });

  it('la misma persona valora dos veces a la vez: una gana, la otra recibe already-rated y queda una sola fila', async () => {
    for (let round = 0; round < 5; round++) {
      const { proposer, exchange } = await setupConfirmedRound(round);

      const results = await Promise.all([
        rateExchange(proposer.firebaseUid, exchange.id, { score: 5 }),
        rateExchange(proposer.firebaseUid, exchange.id, { score: 2 }),
      ]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'already-rated' });
      expect(await prisma.rating.count({ where: { exchangeId: exchange.id } })).toBe(1);
    }
  });
});

describe('ratingService — red de seguridad del índice único', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Con el bloqueo de la card no debería pasar: simula que la comprobación previa no ve una valoración ya guardada.
  it('si la inserción choca con una valoración existente responde already-rated, no un error', async () => {
    const { author, proposer, exchange } = await setupConfirmedRound(0);
    await prisma.rating.create({ data: { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 5 } });

    const realTransaction = prisma.$transaction.bind(prisma) as (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>;
    vi.spyOn(prisma, '$transaction').mockImplementation(((fn: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      realTransaction((tx) => {
        const blindRating = { count: async () => 0, create: tx.rating.create.bind(tx.rating) };
        return fn(new Proxy(tx, { get: (target, key) => (key === 'rating' ? blindRating : Reflect.get(target, key)) }));
      })) as never);

    const result = await rateExchange(proposer.firebaseUid, exchange.id, { score: 1 });

    expect(result).toEqual({ ok: false, reason: 'already-rated' });
    expect(await prisma.rating.findMany()).toEqual([expect.objectContaining({ score: 5 })]);
  });
});
