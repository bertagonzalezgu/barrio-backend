import { Types } from 'mongoose';
import { Transaction } from '../models/Transaction';

const ticketId = new Types.ObjectId();
const deUserId = new Types.ObjectId();
const aUserId = new Types.ObjectId();

describe('Transaction model', () => {
  beforeAll(async () => {
    await Transaction.init();
  });

  it('crea una transacción de intercambio válida', async () => {
    const tx = await Transaction.create({ tipo: 'intercambio', ticketId, deUserId, aUserId, horas: 2 });
    expect(tx._id).toBeDefined();
    expect(tx.fecha).toBeDefined();
  });

  it('falla si falta el tipo', async () => {
    await expect(
      Transaction.create({ ticketId, deUserId, aUserId, horas: 2 })
    ).rejects.toThrow();
  });

  it('falla si una transacción de intercambio no tiene ticketId', async () => {
    await expect(
      Transaction.create({ tipo: 'intercambio', deUserId, aUserId, horas: 2 })
    ).rejects.toThrow();
  });

  it('falla si una transacción de intercambio no tiene deUserId', async () => {
    await expect(
      Transaction.create({ tipo: 'intercambio', ticketId, aUserId, horas: 2 })
    ).rejects.toThrow();
  });

  it('falla si horas es menor que 1', async () => {
    await expect(
      Transaction.create({ tipo: 'intercambio', ticketId, deUserId, aUserId, horas: 0 })
    ).rejects.toThrow();
  });

  it('permite una transacción de bienvenida sin ticketId ni deUserId', async () => {
    const tx = await Transaction.create({ tipo: 'bienvenida', aUserId, horas: 2 });
    expect(tx._id).toBeDefined();
  });

  it('rechaza una segunda transacción de bienvenida para el mismo usuario', async () => {
    await Transaction.create({ tipo: 'bienvenida', aUserId, horas: 2 });
    await expect(
      Transaction.create({ tipo: 'bienvenida', aUserId, horas: 2 })
    ).rejects.toThrow(/duplicate key/);
  });

  it('permite varios intercambios hacia el mismo usuario', async () => {
    await Transaction.create({ tipo: 'intercambio', ticketId, deUserId, aUserId, horas: 1 });
    await expect(
      Transaction.create({ tipo: 'intercambio', ticketId, deUserId, aUserId, horas: 1 })
    ).resolves.toBeDefined();
  });
});
