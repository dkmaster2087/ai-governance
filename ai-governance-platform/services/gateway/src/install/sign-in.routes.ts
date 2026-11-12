import { FastifyInstance } from 'fastify';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { collection } from '@ai-governance/storage';
import { createLogger } from '@ai-governance/utils';
import { oidcClient, OidcError, pkce } from '../mcp/oidc';
import { SignInError, signInWithPassword, signInWithSso, ssoConfig } from './sign-in';

const logger = createLogger('gateway:install-sign-in');

/** Where the dashboard lands after the identity provider: the session travels in the fragment, never to a server. */
const back = (fragment: Record<string, string>) => `/login#${new URLSearchParams(fragment).toString()}`;

/** A sign-in started at the identity provider: what's needed to finish it, for ten minutes. */
const pending = () => collection<{ tenantId: string; period: string; verifier: string; nonce: string; ttl: number }>('metrics');

/**
 * Sign-in for a customer-run install's dashboard (routes are only registered there). Public by design: each
 * route is a way to sign in. Wrong passwords are limited per person (sign-in.ts) and per address (here).
 */
export async function installSignInRoutes(app: FastifyInstance) {
  const publicUrl = () => (process.env.PUBLIC_GATEWAY_URL || '').replace(/\/$/, '');
  const redirectUri = () => `${publicUrl()}/v1/auth/sso/callback`;

  app.get('/auth/methods', async () => {
    const sso = ssoConfig();
    return { password: true, sso: sso ? { name: sso.name } : null };
  });

  const passwordInput = z.object({
    email: z.string().trim().email().max(320),
    password: z.string().min(1).max(256),
    newPassword: z.string().max(256).optional(),
  });
  app.post('/auth/password', { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } }, async (request, reply) => {
    const parsed = passwordInput.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Enter your email and password', code: 'INVALID_INPUT' });
    try {
      return await signInWithPassword(parsed.data.email, parsed.data.password, parsed.data.newPassword);
    } catch (err) {
      if (err instanceof SignInError) return reply.status(err.statusCode).send({ error: err.message, code: err.code });
      throw err;
    }
  });

  app.get('/auth/sso/start', { config: { rateLimit: { max: 30, timeWindow: '5 minutes' } } }, async (_request, reply) => {
    const cfg = ssoConfig();
    if (!cfg) return reply.redirect(back({ error: 'Company sign-in isn’t set up on this install.' }));
    if (!publicUrl()) return reply.redirect(back({ error: 'PUBLIC_GATEWAY_URL isn’t set, so the identity provider can’t send you back.' }));
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const { verifier, challenge } = pkce();
    await pending().put({ tenantId: '_install', period: `sso#${state}`, verifier, nonce, ttl: Math.floor(Date.now() / 1000) + 600 });
    try {
      return reply.redirect(await oidcClient().authorizeUrl(cfg, { redirectUri: redirectUri(), state, nonce, challenge }));
    } catch (err) {
      logger.warn('Company sign-in unavailable', { error: (err as Error).message });
      return reply.redirect(back({ error: (err as OidcError).message }));
    }
  });

  app.get('/auth/sso/callback', async (request, reply) => {
    const q = request.query as { code?: string; state?: string; error?: string; error_description?: string };
    if (q.error) return reply.redirect(back({ error: `Your company sign-in said: ${q.error_description || q.error}` }));
    const cfg = ssoConfig();
    if (!cfg || !q.code || !q.state) return reply.redirect(back({ error: 'That sign-in can’t be finished. Start again.' }));
    const key = { tenantId: '_install', period: `sso#${q.state}` };
    const started = await pending().get(key);
    await pending().delete(key);
    if (!started || started.ttl * 1000 < Date.now()) return reply.redirect(back({ error: 'That sign-in took too long or was already used. Start again.' }));
    try {
      const tokens = await oidcClient().exchange(cfg, cfg.secret, q.code, redirectUri(), started.verifier);
      const person = await oidcClient().person(cfg, tokens.idToken, started.nonce);
      const session = await signInWithSso(person.email);
      return reply.redirect(back({ session: session.token }));
    } catch (err) {
      const message = err instanceof SignInError || err instanceof OidcError ? err.message : 'Company sign-in failed. Try again.';
      logger.warn('Company sign-in refused', { error: (err as Error).message });
      return reply.redirect(back({ error: message }));
    }
  });
}
