import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma';
import type { CardType, ExchangeStatus, Prisma } from '../generated/prisma/client';
import { CARD_TYPES } from './cardService';
import { grantWelcomeCredit, getBalance, getBalanceByUserId, payerOf, WELCOME_CREDIT_HOURS } from './walletService';

async function createUser(firebaseUid = 'uid-wallet-001') {
  return prisma.user.create({ data: { firebaseUid, name: 'Ana', email: `${firebaseUid}@barrio.local` } });
}

async function createExchange(
  proposerId: string,
  receiverId: string,
  hours: number,
  status: ExchangeStatus,
  type: CardType = 'offer',
) {
  const card = await prisma.card.create({
    data: { authorId: receiverId, type, title: 'Card', description: 'Desc', category: 'home_repairs', hours },
  });
  return prisma.exchange.create({ data: { cardId: card.id, proposerId, receiverId, hours, status } });
}

describe('walletService', () => {
  describe('grantWelcomeCredit', () => {
    it('crea una transferencia de bienvenida de +2h sin origen ni intercambio', async () => {
      const user = await createUser();

      const granted = await grantWelcomeCredit(user.id);

      expect(granted).toBe(true);
      const txs = await prisma.timeTransaction.findMany({ where: { toUserId: user.id } });
      expect(txs).toHaveLength(1);
      expect(txs[0]).toMatchObject({
        type: 'transfer',
        hours: WELCOME_CREDIT_HOURS,
        fromUserId: null,
        exchangeId: null,
      });
      expect((await getBalance(user.firebaseUid))?.balance).toBe(2);
    });

    it('es idempotente: una segunda llamada no crea otra transacción ni suma horas', async () => {
      const user = await createUser();

      await grantWelcomeCredit(user.id);
      const grantedAgain = await grantWelcomeCredit(user.id);

      expect(grantedAgain).toBe(false);
      expect(await prisma.timeTransaction.count({ where: { toUserId: user.id } })).toBe(1);
      expect((await getBalance(user.firebaseUid))?.balance).toBe(2);
    });

    it('es idempotente también con llamadas simultáneas', async () => {
      const user = await createUser();

      const results = await Promise.all([
        grantWelcomeCredit(user.id),
        grantWelcomeCredit(user.id),
        grantWelcomeCredit(user.id),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await prisma.timeTransaction.count({ where: { toUserId: user.id } })).toBe(1);
      expect((await getBalance(user.firebaseUid))?.balance).toBe(2);
    });

    it('lanza error y no deja una transacción huérfana si el usuario no existe', async () => {
      const ghostId = randomUUID();

      await expect(grantWelcomeCredit(ghostId)).rejects.toThrow();
      expect(await prisma.timeTransaction.count()).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('devuelve el saldo del usuario por su firebaseUid', async () => {
      const user = await createUser('uid-balance');
      await grantWelcomeCredit(user.id);

      expect(await getBalance('uid-balance')).toEqual({ balance: 2, reserved: 0, available: 2 });
    });

    it('resta las transferencias salientes de las entrantes', async () => {
      const ana = await createUser('uid-ana');
      const bea = await createUser('uid-bea');
      await prisma.timeTransaction.createMany({
        data: [
          { type: 'transfer', toUserId: ana.id, hours: 5 },
          { type: 'transfer', fromUserId: ana.id, toUserId: bea.id, hours: 3 },
        ],
      });

      expect((await getBalance('uid-ana'))?.balance).toBe(2);
      expect((await getBalance('uid-bea'))?.balance).toBe(3);
    });

    it('en cards offer cuenta como reservadas las horas del proponente en intercambios aceptados o realizados', async () => {
      const ana = await createUser('uid-ana');
      const bea = await createUser('uid-bea');
      await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: ana.id, hours: 5 } });
      await createExchange(ana.id, bea.id, 1, 'accepted');
      await createExchange(ana.id, bea.id, 2, 'done');
      await createExchange(ana.id, bea.id, 4, 'proposed');
      await createExchange(ana.id, bea.id, 4, 'confirmed');
      await createExchange(ana.id, bea.id, 4, 'cancelled');

      expect(await getBalance('uid-ana')).toEqual({ balance: 5, reserved: 3, available: 2 });
      expect(await getBalance('uid-bea')).toEqual({ balance: 0, reserved: 0, available: 0 });
    });

    // En una card "busco" quien recibe la ayuda (y paga) es la autora, no quien propone.
    it('en cards request cuenta como reservadas las horas de la autora (receptora), no las del proponente', async () => {
      const ana = await createUser('uid-ana');
      const bea = await createUser('uid-bea');
      await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: bea.id, hours: 5 } });
      await createExchange(ana.id, bea.id, 1, 'accepted', 'request');
      await createExchange(ana.id, bea.id, 2, 'done', 'request');
      await createExchange(ana.id, bea.id, 4, 'proposed', 'request');
      await createExchange(ana.id, bea.id, 4, 'rejected', 'request');

      expect(await getBalance('uid-bea')).toEqual({ balance: 5, reserved: 3, available: 2 });
      expect(await getBalance('uid-ana')).toEqual({ balance: 0, reserved: 0, available: 0 });
    });

    it('devuelve null si no existe el usuario', async () => {
      expect(await getBalance('uid-inexistente')).toBeNull();
    });
  });

  describe('getBalanceByUserId', () => {
    it('calcula el mismo saldo que getBalance a partir del id interno', async () => {
      const ana = await createUser('uid-ana');
      const bea = await createUser('uid-bea');
      await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: ana.id, hours: 5 } });
      await createExchange(ana.id, bea.id, 2, 'accepted');

      expect(await getBalanceByUserId(ana.id)).toEqual({ balance: 5, reserved: 2, available: 3 });
    });

    // La regla de quién paga está en payerOf y también en la consulta del saldo: este test las mantiene de acuerdo.
    it.each(CARD_TYPES)('en una card %s reserva las horas de quien indica payerOf, y no las de la otra persona', async (type) => {
      const ana = await createUser('uid-ana');
      const bea = await createUser('uid-bea');
      const exchange = await createExchange(ana.id, bea.id, 2, 'accepted', type);
      const payerId = payerOf(type, exchange);
      const otherId = payerId === ana.id ? bea.id : ana.id;

      expect((await getBalanceByUserId(payerId)).reserved).toBe(2);
      expect((await getBalanceByUserId(otherId)).reserved).toBe(0);
    });

    // Una confirmación a la vez cambia dos cifras: crea la transferencia (sube lo que sale) y deja de reservar.
    // Si el saldo se leyera en varias consultas y la confirmación entrase entre ellas, una vería el antes y otra el después.
    it.each([1, 2])(
      'una confirmación que se confirma justo antes de la consulta %i del cálculo no altera el disponible',
      async (commitBeforeQuery) => {
        const ana = await createUser('uid-ana');
        const bea = await createUser('uid-bea');
        await prisma.timeTransaction.create({ data: { type: 'transfer', toUserId: ana.id, hours: 5 } });
        const exchange = await createExchange(ana.id, bea.id, 3, 'done');
        const confirm = () =>
          prisma.$transaction([
            prisma.exchange.update({ where: { id: exchange.id }, data: { status: 'confirmed', confirmedAt: new Date() } }),
            prisma.timeTransaction.create({
              data: { type: 'transfer', fromUserId: ana.id, toUserId: bea.id, hours: 3, exchangeId: exchange.id },
            }),
          ]);
        const db = sequentialClient(commitBeforeQuery, confirm);

        const balance = await getBalanceByUserId(ana.id, db.client);
        if (!db.committed()) await confirm();

        // Antes de confirmar: saldo 5, reservado 3. Después: saldo 2, reservado 0. El disponible es 2 en los dos casos.
        expect(balance.available).toBe(2);
        expect(await getBalanceByUserId(ana.id)).toEqual({ balance: 2, reserved: 0, available: 2 });
      },
    );
  });
});

type Query = (...args: unknown[]) => Promise<unknown>;

// Cliente de prueba: ejecuta las consultas una detrás de otra, en el orden en que se lanzan, y justo antes de la
// consulta número `commitBefore` (empezando en 0) deja que otra operación se confirme. Así la carrera es determinista.
function sequentialClient(commitBefore: number, commit: () => Promise<unknown>) {
  let previous: Promise<unknown> = Promise.resolve();
  let issued = 0;
  let committed = false;

  const run = (query: () => Promise<unknown>): Promise<unknown> => {
    const index = issued++;
    const result = previous.then(async () => {
      if (index === commitBefore) {
        await commit();
        committed = true;
      }
      return query();
    });
    previous = result.catch(() => undefined);
    return result;
  };

  const wrap = (target: object): object =>
    new Proxy(target, {
      get(obj, prop) {
        const value: unknown = Reflect.get(obj, prop);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => run(() => (value as Query).apply(obj, args));
      },
    });

  const client = new Proxy(prisma, {
    get(obj, prop) {
      const value: unknown = Reflect.get(obj, prop);
      if (prop === '$queryRaw' && typeof value === 'function') {
        return (...args: unknown[]) => run(() => (value as Query).apply(obj, args));
      }
      if (prop === 'timeTransaction' || prop === 'exchange') return wrap(value as object);
      return value;
    },
  }) as unknown as Prisma.TransactionClient;

  return { client, committed: () => committed };
}
