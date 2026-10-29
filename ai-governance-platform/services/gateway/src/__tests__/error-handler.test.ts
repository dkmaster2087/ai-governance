import Fastify from 'fastify';
import { z } from 'zod';
import { AppError } from '@ai-governance/utils';
import { errorHandler } from '../middleware/error.handler';

async function app() {
  const a = Fastify();
  a.setErrorHandler(errorHandler);
  a.post('/zod', async (req) => z.object({ model: z.string() }).parse(req.body));
  a.get('/app', async () => { throw new AppError('POLICY_VIOLATION', 'Stopped', 403); });
  a.get('/plain', async () => { throw Object.assign(new Error('Blocked by rule'), { code: 'POLICY_VIOLATION', statusCode: 403 }); });
  a.get('/boom', async () => { throw new Error('secret internals'); });
  return a;
}

describe('error handler', () => {
  it('turns invalid bodies into 400 with field details', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/zod', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().issues[0].path).toBe('model');
  });

  it('keeps malformed JSON as a 400', async () => {
    const res = await (await app()).inject({ method: 'POST', url: '/zod', payload: '{not json', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(400);
  });

  it('keeps application and policy errors as they are', async () => {
    const a = await app();
    expect((await a.inject({ method: 'GET', url: '/app' })).json()).toMatchObject({ code: 'POLICY_VIOLATION', message: 'Stopped' });
    const plain = await a.inject({ method: 'GET', url: '/plain' });
    expect(plain.statusCode).toBe(403);
    expect(plain.json()).toMatchObject({ code: 'POLICY_VIOLATION', message: 'Blocked by rule' });
  });

  it('hides unexpected errors behind a 500', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('secret internals');
  });
});
