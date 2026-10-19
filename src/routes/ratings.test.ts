import request from 'supertest';
import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

const AUTHOR_UID = 'uid-autora';
const PROPOSER_UID = 'uid-proponente';
const OUTSIDER_UID = 'uid-ajena';

// El token es el propio uid: así las peticiones simultáneas no dependen del orden de los mocks.
beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockVerifyIdToken.mockImplementation(async (token: string) => ({ uid: token }));
});

function createUser(firebaseUid: string) {
  return prisma.user.create({ data: { firebaseUid, name: firebaseUid, email: `${firebaseUid}@barrio.local` } });
}

// Autora, proponente y un intercambio sobre una card de la autora; también existe una tercera usuaria registrada.
async function setupExchange(status: ExchangeStatus = 'confirmed') {
  const author = await createUser(AUTHOR_UID);
  const proposer = await createUser(PROPOSER_UID);
  await createUser(OUTSIDER_UID);
  const card = await prisma.card.create({
    data: { authorId: author.id, type: 'request', hours: 3, status: 'completed', title: 'Regar plantas', description: 'Desc', category: 'garden' },
  });
  const both = ['confirmed', 'rated'].includes(status) ? new Date() : null;
  const exchange = await prisma.exchange.create({
    data: { cardId: card.id, proposerId: proposer.id, receiverId: author.id, hours: 3, status, proposerConfirmedAt: both, receiverConfirmedAt: both },
  });
  return { author, proposer, card, exchange };
}

describe('modelo Rating', () => {
  it.each([0, 6])('la base de datos rechaza una puntuación %i aunque se salte la validación de la API', async (score) => {
    const { author, proposer, exchange } = await setupExchange();

    await expect(
      prisma.rating.create({ data: { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score } }),
    ).rejects.toThrow();
    expect(await prisma.rating.count()).toBe(0);
  });

  it('la base de datos rechaza una segunda valoración de la misma persona en el mismo intercambio', async () => {
    const { author, proposer, exchange } = await setupExchange();
    const data = { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 4 };
    await prisma.rating.create({ data });

    await expect(prisma.rating.create({ data })).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.rating.count()).toBe(1);
  });

  it('guarda la valoración con comentario opcional y fecha', async () => {
    const { author, proposer, exchange } = await setupExchange();

    const rating = await prisma.rating.create({
      data: { exchangeId: exchange.id, raterId: proposer.id, ratedUserId: author.id, score: 5 },
    });

    expect(rating).toMatchObject({ score: 5, comment: null, createdAt: expect.any(Date) });
  });
});
