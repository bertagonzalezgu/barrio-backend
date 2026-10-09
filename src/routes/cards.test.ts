import request from 'supertest';
import { prisma } from '../config/prisma';

const mockVerifyIdToken = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

import app from '../app';

const AUTHOR_UID = 'uid-autora';

const requiredFields = {
  type: 'request',
  title: 'Regar plantas',
  description: 'Necesito que alguien riegue mis plantas 5 días',
  category: 'garden',
  hours: 2,
} as const;

function createAuthor() {
  return prisma.user.create({ data: { firebaseUid: AUTHOR_UID, name: 'Autora', email: 'autora@barrio.local' } });
}

function postCardAs(body: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValueOnce({ uid: AUTHOR_UID } as never);
  return request(app).post('/api/cards').set('Authorization', 'Bearer token-valido').send(body);
}

function getCards(query: Record<string, string> = {}) {
  mockVerifyIdToken.mockResolvedValueOnce({ uid: AUTHOR_UID } as never);
  return request(app).get('/api/cards').query(query).set('Authorization', 'Bearer token-valido');
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
});

describe('POST /api/cards', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/cards').send(requiredFields);
    expect(res.status).toBe(401);
  });

  // buscar.feature — "Publicar con fecha de inicio y duración de varios días"
  it('crea la card con todos los campos', async () => {
    const author = await createAuthor();
    const body = {
      ...requiredFields,
      icon: 'plant',
      lat: 41.3851,
      lng: 2.1734,
      startDate: '2026-10-10T00:00:00.000Z',
      endDate: '2026-10-15T00:00:00.000Z',
    };

    const res = await postCardAs(body);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...body, authorId: author.id, status: 'active' });
    expect(res.body.id).toEqual(expect.any(String));
    expect(await prisma.card.count()).toBe(1);
  });

  // buscar.feature — "Publicar una tarjeta de 'busco' con éxito"
  it('crea la card sin campos opcionales', async () => {
    const author = await createAuthor();

    const res = await postCardAs(requiredFields);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ...requiredFields,
      authorId: author.id,
      status: 'active',
      icon: '',
      lat: null,
      lng: null,
      startDate: null,
      endDate: null,
    });
  });

  // buscar.feature — "Intentar publicar sin categoría"
  it('devuelve 400 sin category y no guarda la card', async () => {
    await createAuthor();
    const { category: _omitted, ...body } = requiredFields;

    const res = await postCardAs(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La categoría es obligatoria' });
    expect(await prisma.card.count()).toBe(0);
  });

  // buscar.feature — "Intentar publicar sin descripción"
  it('devuelve 400 sin description y no guarda la card', async () => {
    await createAuthor();
    const { description: _omitted, ...body } = requiredFields;

    const res = await postCardAs(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La descripción es obligatoria' });
    expect(await prisma.card.count()).toBe(0);
  });

  it.each([
    ['type inválido', { type: 'busco' }, 'El tipo debe ser uno de: request, offer'],
    ['category inválida', { category: 'Cuidados' }, 'La categoría debe ser una de: home_repairs, cleaning, moving, garden, peoplecare, petcare, health_support, learning, workshops, digital, cooking, transport, events, sports, creative_projects'],
    ['title vacío (solo espacios)', { title: '   ' }, 'El título es obligatorio'],
    ['title de más de 120 caracteres', { title: 'a'.repeat(121) }, 'El título debe ser un texto de 120 caracteres como máximo'],
    [
      'description de más de 1000 caracteres',
      { description: 'a'.repeat(1001) },
      'La descripción debe ser un texto de 1000 caracteres como máximo',
    ],
    ['hours = 0', { hours: 0 }, 'Las horas deben ser un número entero mayor que 0'],
    ['hours negativo', { hours: -3 }, 'Las horas deben ser un número entero mayor que 0'],
    ['lat sin lng', { lat: 41.3851 }, 'La ubicación necesita lat y lng a la vez'],
    [
      'endDate anterior a startDate',
      { startDate: '2026-10-15T00:00:00.000Z', endDate: '2026-10-10T00:00:00.000Z' },
      'La fecha de fin no puede ser anterior a la de inicio',
    ],
  ])('devuelve 400 con %s y no guarda la card', async (_case, overrides, error) => {
    await createAuthor();

    const res = await postCardAs({ ...requiredFields, ...overrides });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error });
    expect(await prisma.card.count()).toBe(0);
  });
});

describe('GET /api/cards', () => {
  async function seedCards() {
    const author = await createAuthor();
    const base = { ...requiredFields, authorId: author.id };
    await prisma.card.createMany({
      data: [
        { ...base, title: 'Busco cuidados', type: 'request', category: 'peoplecare' },
        { ...base, title: 'Ofrezco cuidados', type: 'offer', category: 'peoplecare' },
        { ...base, title: 'Ofrezco ayuda digital', type: 'offer', category: 'digital' },
        { ...base, title: 'Completada', status: 'completed' },
        { ...base, title: 'Denunciada', status: 'reported' },
      ],
    });
  }

  function titles(res: request.Response): string[] {
    return (res.body as { title: string }[]).map((card) => card.title).sort();
  }

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(401);
  });

  it('devuelve solo las cards activas', async () => {
    await seedCards();

    const res = await getCards();

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Busco cuidados', 'Ofrezco ayuda digital', 'Ofrezco cuidados']);
  });

  it('filtra por category', async () => {
    await seedCards();

    const res = await getCards({ category: 'peoplecare' });

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Busco cuidados', 'Ofrezco cuidados']);
  });

  it('filtra por type', async () => {
    await seedCards();

    const res = await getCards({ type: 'offer' });

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Ofrezco ayuda digital', 'Ofrezco cuidados']);
  });

  it('devuelve 400 si category no es un valor del enum', async () => {
    await seedCards();

    const res = await getCards({ category: 'foo' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'La categoría debe ser una de: home_repairs, cleaning, moving, garden, peoplecare, petcare, health_support, learning, workshops, digital, cooking, transport, events, sports, creative_projects' });
  });
});

describe('GET /api/cards/:id', () => {
  function getCard(id: string) {
    mockVerifyIdToken.mockResolvedValueOnce({ uid: AUTHOR_UID } as never);
    return request(app).get(`/api/cards/${id}`).set('Authorization', 'Bearer token-valido');
  }

  it('devuelve 401 sin token', async () => {
    const res = await request(app).get('/api/cards/cualquiera');
    expect(res.status).toBe(401);
  });

  it('devuelve la card con su autor', async () => {
    const author = await createAuthor();
    const card = await prisma.card.create({ data: { ...requiredFields, authorId: author.id } });

    const res = await getCard(card.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...requiredFields, id: card.id, authorId: author.id });
    expect(res.body.author).toEqual({ id: author.id, name: 'Autora', firebaseUid: AUTHOR_UID });
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await getCard('no-existe');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Card not found' });
  });

  it('devuelve 404 si la card está eliminada', async () => {
    const author = await createAuthor();
    const card = await prisma.card.create({ data: { ...requiredFields, authorId: author.id, status: 'deleted' } });

    const res = await getCard(card.id);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Card not found' });
  });
});

describe('DELETE /api/cards/:id', () => {
  function deleteCardAs(uid: string, id: string) {
    mockVerifyIdToken.mockResolvedValueOnce({ uid } as never);
    return request(app).delete(`/api/cards/${id}`).set('Authorization', 'Bearer token-valido');
  }

  async function seedCard() {
    const author = await createAuthor();
    return prisma.card.create({ data: { ...requiredFields, authorId: author.id } });
  }

  it('devuelve 401 sin token', async () => {
    const res = await request(app).delete('/api/cards/cualquiera');
    expect(res.status).toBe(401);
  });

  it('la autora elimina su card y recibe 204 sin body', async () => {
    const card = await seedCard();

    const res = await deleteCardAs(AUTHOR_UID, card.id);

    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(await prisma.card.findUnique({ where: { id: card.id } })).toMatchObject({ status: 'deleted' });
  });

  it('devuelve 403 si quien borra no es la autora y no borra la card', async () => {
    const card = await seedCard();
    await prisma.user.create({ data: { firebaseUid: 'uid-otra', name: 'Otra', email: 'otra@barrio.local' } });

    const res = await deleteCardAs('uid-otra', card.id);

    expect(res.status).toBe(403);
    expect(await prisma.card.findUnique({ where: { id: card.id } })).toMatchObject({ status: 'active' });
  });

  it('devuelve 404 si la card no existe', async () => {
    const res = await deleteCardAs(AUTHOR_UID, 'no-existe');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Card not found' });
  });

  it('devuelve 404 si la card ya estaba eliminada', async () => {
    const card = await seedCard();
    await prisma.card.update({ where: { id: card.id }, data: { status: 'deleted' } });

    const res = await deleteCardAs(AUTHOR_UID, card.id);

    expect(res.status).toBe(404);
  });

  it('conserva los intercambios de la card eliminada', async () => {
    const card = await seedCard();
    const other = await prisma.user.create({ data: { firebaseUid: 'uid-otra', name: 'Otra', email: 'otra@barrio.local' } });
    await prisma.exchange.create({
      data: { cardId: card.id, proposerId: other.id, receiverId: card.authorId, hours: card.hours },
    });

    const res = await deleteCardAs(AUTHOR_UID, card.id);

    expect(res.status).toBe(204);
    expect(await prisma.exchange.count({ where: { cardId: card.id } })).toBe(1);
  });

  it('la card eliminada no aparece en el feed', async () => {
    const card = await seedCard();
    await deleteCardAs(AUTHOR_UID, card.id);

    const res = await getCards();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
