import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma';
import type { ExchangeStatus } from '../generated/prisma/client';
import { grantWelcomeCredit, getBalance, WELCOME_CREDIT_HOURS } from './walletService';

async function createUser(firebaseUid = 'uid-wallet-001') {
  return prisma.user.create({ data: { firebaseUid, name: 'Ana', email: `${firebaseUid}@barrio.local` } });
}

async function createExchange(proposerId: string, receiverId: string, hours: number, status: ExchangeStatus) {
  const ticket = await prisma.ticket.create({
    data: { authorId: receiverId, type: 'offer', title: 'Ticket', description: 'Desc', category: 'home', hours },
  });
  return prisma.exchange.create({ data: { ticketId: ticket.id, proposerId, receiverId, hours, status } });
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

    it('cuenta como reservadas las horas del proponente en intercambios aceptados o realizados', async () => {
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

    it('devuelve null si no existe el usuario', async () => {
      expect(await getBalance('uid-inexistente')).toBeNull();
    });
  });
});
