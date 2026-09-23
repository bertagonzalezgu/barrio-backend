import { Types } from 'mongoose';
import { Transaction } from '../models/Transaction';

const ticketId = new Types.ObjectId();
const deUserId = new Types.ObjectId();
const aUserId = new Types.ObjectId();

describe('Transaction model', () => {
  it('crea una transacción válida', async () => {
    const tx = await Transaction.create({ ticketId, deUserId, aUserId, horas: 2 });
    expect(tx._id).toBeDefined();
    expect(tx.fecha).toBeDefined();
  });

  it('falla si falta ticketId', async () => {
    await expect(
      Transaction.create({ deUserId, aUserId, horas: 2 })
    ).rejects.toThrow();
  });

  it('falla si horas es menor que 1', async () => {
    await expect(
      Transaction.create({ ticketId, deUserId, aUserId, horas: 0 })
    ).rejects.toThrow();
  });
});