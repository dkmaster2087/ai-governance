import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply } from 'fastify';

/**
 * A customer-run install serves its own dashboard (the image has it in DASHBOARD_DIR, built for install sign-in).
 * Pages and their files come from that folder; any other path that isn't the API answers with the dashboard, which
 * routes in the browser. The API stays where it is; the dashboard reaches it under /api, as in Cloud, and
 * stripApiPrefix() (used when the app is made) removes that prefix.
 */

/** Paths that belong to the API, never to the dashboard. */
export const API_PATHS = /^\/(v1|mcp|oauth|public|health|connector|\.well-known)(\/|$)/;

/** For Fastify's rewriteUrl: /api/v1/rules → /v1/rules. */
export const stripApiPrefix = (url: string) => (url === '/api' || url.startsWith('/api/') ? url.slice(4) || '/' : url);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

export async function serveDashboard(app: FastifyInstance, dir = process.env.DASHBOARD_DIR || '') {
  const root = dir && fs.existsSync(path.join(dir, 'index.html')) ? path.resolve(dir) : null;
  const send = (reply: FastifyReply, file: string, immutable: boolean) => reply
    .header('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream')
    // Built files carry a hash in their name and never change; index.html must always be fetched fresh.
    .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .send(fs.createReadStream(file));

  app.setNotFoundHandler((request, reply) => {
    const urlPath = decodeURIComponent(request.url.split('?')[0]);
    if (!root || (request.method !== 'GET' && request.method !== 'HEAD') || API_PATHS.test(urlPath)) {
      return reply.status(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
    }
    // A file of the dashboard, never anything outside its folder.
    const file = path.resolve(root, '.' + urlPath);
    if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(reply, file, urlPath.startsWith('/assets/'));
    }
    // A page: the dashboard routes it in the browser.
    return send(reply, path.join(root, 'index.html'), false);
  });
}
