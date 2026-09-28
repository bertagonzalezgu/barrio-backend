import { Types } from 'mongoose';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { grantWelcomeCredit, getBalance, WELCOME_CREDIT_HOURS } from './walletService';

async function createUser(firebaseUid = 'uid-wallet-001') {
  return User.create({ firebaseUid, name: 'Ana', email: `${firebaseUid}@barrio.local` });
}

describe('walletService', () => {
  beforeAll(async () => {
    await Transaction.init();
  });

  describe('grantWelcomeCredit', () => {
    it('crea una transacción de bienvenida de +2h y deja el saldo en 2', async () => {
      const user = await createUser();

      const granted = await grantWelcomeCredit(user._id);

      expect(granted).toBe(true);
      const txs = await Transaction.find({ toUserId: user._id });
      expect(txs).toHaveLength(1);
      expect(txs[0].type).toBe('welcome');
      expect(txs[0].hours).toBe(WELCOME_CREDIT_HOURS);
      const updated = await User.findById(user._id);
      expect(updated?.credits).toBe(2);
    });

    it('es idempotente: una segunda llamada no crea otra transacción ni suma horas', async () => {
      const user = await createUser();

      await grantWelcomeCredit(user._id);
      const grantedAgain = await grantWelcomeCredit(user._id);

      expect(grantedAgain).toBe(false);
      expect(await Transaction.countDocuments({ toUserId: user._id })).toBe(1);
      expect((await User.findById(user._id))?.credits).toBe(2);
    });

    it('es idempotente también con llamadas simultáneas', async () => {
      const user = await createUser();

      const results = await Promise.all([
        grantWelcomeCredit(user._id),
        grantWelcomeCredit(user._id),
        grantWelcomeCredit(user._id),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await Transaction.countDocuments({ toUserId: user._id })).toBe(1);
      expect((await User.findById(user._id))?.credits).toBe(2);
    });

    it('lanza error y no deja una transacción huérfana si el usuario no existe', async () => {
      const ghostId = new Types.ObjectId();

      await expect(grantWelcomeCredit(ghostId)).rejects.toThrow();
      expect(await Transaction.countDocuments({ toUserId: ghostId })).toBe(0);
    });
  });

  describe('getBalance', () => {
    it('devuelve los créditos del usuario por su firebaseUid', async () => {
      const user = await createUser('uid-balance');
      await grantWelcomeCredit(user._id);

      expect(await getBalance('uid-balance')).toBe(2);
    });

    it('devuelve null si no existe el usuario', async () => {
      expect(await getBalance('uid-inexistente')).toBeNull();
    });
  });
});
