import { Types } from 'mongoose';
import { Ticket } from './Ticket';

const authorId = new Types.ObjectId();

describe('Ticket model', () => {
  it('crea un ticket válido con los campos requeridos', async () => {
    const ticket = await Ticket.create({
      authorId,
      type: 'offer',
      title: 'Ayudo con mudanzas',
      description: 'Puedo ayudar con cajas ligeras',
      category: 'home',
      hours: 2,
    });
    expect(ticket._id).toBeDefined();
    expect(ticket.status).toBe('active');
  });

  it('falla con un tipo inválido', async () => {
  await expect(
    Ticket.create({ authorId, type: 'gift' as any, title: 'Test', description: 'Test', category: 'home', hours: 2 })
  ).rejects.toThrow();
    });

    it('falla con una categoría inválida', async () => {
    await expect(
        Ticket.create({ authorId, type: 'request', title: 'Test', description: 'Test', category: 'sports' as any, hours: 2 })
    ).rejects.toThrow();
    });

  it('falla si horas es 0', async () => {
    await expect(
      Ticket.create({ authorId, type: 'request', title: 'Test', description: 'Test', category: 'home', hours: 0 })
    ).rejects.toThrow();
  });
});