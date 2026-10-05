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
