import request from 'supertest';
import app from '../app';

describe('errorHandler', () => {
  it('un JSON mal formado sigue siendo un 400, con un código genérico y sin detalles del parser', async () => {
    const res = await request(app)
      .post('/api/exchanges/x/messages')
      .set('Content-Type', 'application/json')
      .send('{"text": ');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });
});
