import { Types } from 'mongoose';
import { Ticket } from './Ticket';

const autorId = new Types.ObjectId();

describe('Ticket model', () => {
  it('crea un ticket válido con los campos requeridos', async () => {
    const ticket = await Ticket.create({
      autorId,
      tipo: 'ofrezco',
      titulo: 'Ayudo con mudanzas',
      descripcion: 'Puedo ayudar con cajas ligeras',
      categoria: 'Hogar',
      horas: 2,
    });
    expect(ticket._id).toBeDefined();
    expect(ticket.estado).toBe('activo');
  });

  it('falla con un tipo inválido', async () => {
  await expect(
    Ticket.create({ autorId, tipo: 'regalo' as any, titulo: 'Test', descripcion: 'Test', categoria: 'Hogar', horas: 2 })
  ).rejects.toThrow();
    });

    it('falla con una categoría inválida', async () => {
    await expect(
        Ticket.create({ autorId, tipo: 'busco', titulo: 'Test', descripcion: 'Test', categoria: 'Deportes' as any, horas: 2 })
    ).rejects.toThrow();
    });

  it('falla si horas es 0', async () => {
    await expect(
      Ticket.create({ autorId, tipo: 'busco', titulo: 'Test', descripcion: 'Test', categoria: 'Hogar', horas: 0 })
    ).rejects.toThrow();
  });
});