import request from 'supertest';

const mockVerifyIdToken = vi.fn();
// Moderación y generación usan el mismo modelo: la primera llamada es siempre la moderación y la segunda la generación.
const mockGenerateContent = vi.fn();

vi.mock('../config/firebase', () => ({
  getAuth: () => ({ verifyIdToken: mockVerifyIdToken }),
}));

vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import app from '../app';
import { GENERATION_SYSTEM_PROMPT, MODERATION_SYSTEM_PROMPT } from '../prompts/generateCard.prompt';

const validBody = { prompt: 'Puedo regar plantas los fines de semana', type: 'offer', category: 'garden' };

const generatedCard = {
  titulo: 'Riego tus plantas',
  descripcion: 'Me encargo de regar tus plantas el fin de semana.',
  icono: 'garden-plant',
};

function geminiReturns(result: object | string) {
  mockGenerateContent.mockResolvedValueOnce({ text: typeof result === 'string' ? result : JSON.stringify(result) });
}

const moderationReturns = geminiReturns;
const generationReturns = geminiReturns;

function postGenerate(body: Record<string, unknown>) {
  mockVerifyIdToken.mockResolvedValueOnce({ uid: 'uid-autora' } as never);
  return request(app).post('/api/cards/generate').set('Authorization', 'Bearer token-valido').send(body);
}

beforeEach(() => {
  mockVerifyIdToken.mockReset();
  mockGenerateContent.mockReset();
});

describe('POST /api/cards/generate', () => {
  it('devuelve 401 sin token', async () => {
    const res = await request(app).post('/api/cards/generate').send(validBody);

    expect(res.status).toBe(401);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it.each([
    ['prompt vacío', { prompt: '   ' }],
    ['type inválido', { type: 'busco' }],
    ['category inválida', { category: 'home' }],
  ])('devuelve 400 con %s y no llama a la IA', async (_caso, override) => {
    const res = await postGenerate({ ...validBody, ...override });

    expect(res.status).toBe(400);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('modera, genera y devuelve titulo, descripcion e icono', async () => {
    moderationReturns({ seguro: true, motivo: 'ok' });
    generationReturns(generatedCard);

    const res = await postGenerate(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(generatedCard);

    const [[moderationParams], [generationParams]] = mockGenerateContent.mock.calls;
    expect(moderationParams.config.systemInstruction).toBe(MODERATION_SYSTEM_PROMPT);
    expect(moderationParams.contents).toBe(validBody.prompt);

    expect(generationParams.config.systemInstruction).toBe(GENERATION_SYSTEM_PROMPT);
    expect(generationParams.contents).toContain('Tipo: offer');
    expect(generationParams.contents).toContain('Categoría: garden');
    expect(generationParams.contents).toContain(validBody.prompt);
  });

  it('devuelve 422 content_rejected si la moderación lo marca como no seguro, sin generar', async () => {
    moderationReturns({ seguro: false, motivo: 'acceso indebido a vivienda' });

    const res = await postGenerate(validBody);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: 'content_rejected' });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
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
    ['la API de Gemini falla', () => mockGenerateContent.mockRejectedValueOnce(new Error('network down'))],
  ])('devuelve 500 generation_failed si %s', async (_caso, arrange) => {
    arrange();

    const res = await postGenerate(validBody);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'generation_failed' });
  });
});
