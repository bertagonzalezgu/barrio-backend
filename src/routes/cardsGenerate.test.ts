import request from 'supertest';

const mockVerifyIdToken = vi.fn();
const mockModerationCreate = vi.fn();
const mockGenerationCreate = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('../config/anthropic', () => ({
  getAnthropic: () => ({
    messages: { create: mockModerationCreate },
    beta: { messages: { create: mockGenerationCreate } },
  }),
}));

import app from '../app';

const validBody = { prompt: 'Puedo regar plantas los fines de semana', type: 'offer', category: 'garden' };

const generatedCard = {
  titulo: 'Riego tus plantas',
  descripcion: 'Me encargo de regar tus plantas el fin de semana.',
  icono: 'garden-plant',
};

function textResponse(text: string) {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn' };
}

function moderationReturns(result: object | string) {
  mockModerationCreate.mockResolvedValueOnce(textResponse(typeof result === 'string' ? result : JSON.stringify(result)));
}

function generationReturns(result: object | string) {
  mockGenerationCreate.mockResolvedValueOnce(textResponse(typeof result === 'string' ? result : JSON.stringify(result)));
}

function postGenerate(body: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-autora' } as never);
  return request(app).post('/api/cards/generate').set('Authorization', 'Bearer token-valido').send(body);
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockModerationCreate.mockReset();
  mockGenerationCreate.mockReset();
});

describe('POST /api/cards/generate', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/cards/generate').send(validBody);

    expect(res.status).toBe(401);
    expect(mockModerationCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['prompt vacío', { prompt: '   ' }],
    ['type inválido', { type: 'busco' }],
    ['category inválida', { category: 'home' }],
  ])('devuelve 400 con %s y no llama a la IA', async (_caso, override) => {
    const res = await postGenerate({ ...validBody, ...override });

    expect(res.status).toBe(400);
    expect(mockModerationCreate).not.toHaveBeenCalled();
    expect(mockGenerationCreate).not.toHaveBeenCalled();
  });

  it('modera, genera y devuelve titulo, descripcion e icono', async () => {
    moderationReturns({ seguro: true, motivo: 'ok' });
    generationReturns(generatedCard);

    const res = await postGenerate(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(generatedCard);

    const moderationParams = mockModerationCreate.mock.calls[0][0];
    expect(moderationParams.model).toBe('claude-haiku-4-5');
    expect(moderationParams.messages).toEqual([{ role: 'user', content: validBody.prompt }]);

    const generationParams = mockGenerationCreate.mock.calls[0][0];
    expect(generationParams.model).toBe('claude-sonnet-5-5');
    expect(generationParams.messages[0].content).toContain('Tipo: offer');
    expect(generationParams.messages[0].content).toContain('Categoría: garden');
    expect(generationParams.messages[0].content).toContain(validBody.prompt);
  });

  it('devuelve 422 content_rejected si la moderación lo marca como no seguro, sin generar', async () => {
    moderationReturns({ seguro: false, motivo: 'acceso indebido a vivienda' });

    const res = await postGenerate(validBody);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'content_rejected' });
    expect(mockGenerationCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['la moderación no devuelve JSON válido', () => moderationReturns('no es json')],
    ['la moderación no devuelve un booleano en seguro', () => moderationReturns({ seguro: 'sí' })],
    ['la generación no devuelve JSON válido', () => {
      moderationReturns({ seguro: true, motivo: 'ok' });
      generationReturns('{"titulo": ');
    }],
    ['la descripción generada está vacía', () => {
      moderationReturns({ seguro: true, motivo: 'ok' });
      generationReturns({ ...generatedCard, descripcion: '' });
    }],
    ['el icono no está en la lista cerrada', () => {
      moderationReturns({ seguro: true, motivo: 'ok' });
      generationReturns({ ...generatedCard, icono: 'garden-cactus' });
    }],
    ['la API de Anthropic falla', () => mockModerationCreate.mockRejectedValueOnce(new Error('network down'))],
  ])('devuelve 500 generation_failed si %s', async (_caso, arrange) => {
    arrange();

    const res = await postGenerate(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'generation_failed' });
  });
});
