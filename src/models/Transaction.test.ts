import { Types } from 'mongoose';
import { Transaction } from '../models/Transaction';

const ticketId = new Types.ObjectId();
const fromUserId = new Types.ObjectId();
const toUserId = new Types.ObjectId();

describe('Transaction model', () => {
  beforeAll(async () => {
    await Transaction.init();
  });

  it('crea una transacción de intercambio válida', async () => {
    const tx = await Transaction.create({ type: 'exchange', ticketId, fromUserId, toUserId, hours: 2 });
    expect(tx._id).toBeDefined();
    expect(tx.date).toBeDefined();
  });

  it('falla si falta el tipo', async () => {
    await expect(
      Transaction.create({ ticketId, fromUserId, toUserId, hours: 2 })
    ).rejects.toThrow();
  });

  it('falla si una transacción de intercambio no tiene ticketId', async () => {
    await expect(
      Transaction.create({ type: 'exchange', fromUserId, toUserId, hours: 2 })
    ).rejects.toThrow();
  });

  it('falla si una transacción de intercambio no tiene deUserId', async () => {
    await expect(
      Transaction.create({ type: 'exchange', ticketId, toUserId, hours: 2 })
    ).rejects.toThrow();
  });

  it('falla si horas es menor que 1', async () => {
    await expect(
      Transaction.create({ type: 'exchange', ticketId, fromUserId, toUserId, hours: 0 })
    ).rejects.toThrow();
  });

  it('permite una transacción de bienvenida sin ticketId ni deUserId', async () => {
    const tx = await Transaction.create({ type: 'welcome', toUserId, hours: 2 });
    expect(tx._id).toBeDefined();
  });

  it('rechaza una segunda transacción de bienvenida para el mismo usuario', async () => {
    await Transaction.create({ type: 'welcome', toUserId, hours: 2 });
    await expect(
      Transaction.create({ type: 'welcome', toUserId, hours: 2 })
    ).rejects.toThrow(/duplicate key/);
  });

  it('permite varios intercambios hacia el mismo usuario', async () => {
    await Transaction.create({ type: 'exchange', ticketId, fromUserId, toUserId, hours: 1 });
    await expect(
      Transaction.create({ type: 'exchange', ticketId, fromUserId, toUserId, hours: 1 })
    ).resolves.toBeDefined();
  });
});
