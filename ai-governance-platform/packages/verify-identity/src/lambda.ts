import { check, GuardOptions, HEADER, Identity, Verifier } from './index';

/**
 * An AWS API Gateway Lambda authorizer (REQUEST type) that lets in only calls carrying a valid
 * X-Probaline-Identity. Works for HTTP APIs (payload 2.0, simple responses) and REST APIs (an IAM policy).
 *
 * Settings (environment): PROBALINE_ISSUER (the gateway's address), PROBALINE_AUDIENCE (this API's base URL as
 * added to Probaline), PROBALINE_REPORT_ONLY=true to log instead of refuse. Turn authorizer caching off, or
 * key it on the X-Probaline-Identity header: each token names one call.
 */

interface Event {
  version?: string;
  type?: string;
  methodArn?: string;
  routeArn?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string; path?: string; sourceIp?: string }; httpMethod?: string; path?: string; identity?: { sourceIp?: string } };
}

const context = (i: Identity | null) => i
  ? { probalineSub: i.sub, probalineKind: i.kind, probalineEmail: i.email ?? '', probalineTool: i.tool, probalineServer: i.server, probalineRequestId: i.rid }
  : { probalineSub: '', probalineReportOnly: 'true' };

export function createAuthorizer(o: GuardOptions) {
  const verifier = new Verifier(o);
  return async (event: Event) => {
    const headers = Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const rc = event.requestContext ?? {};
    const r = await check(verifier, o, headers[HEADER], {
      method: rc.http?.method ?? rc.httpMethod, path: rc.http?.path ?? rc.path, ip: rc.http?.sourceIp ?? rc.identity?.sourceIp,
    });
    const allowed = !r.error;
    if (event.version === '2.0') return { isAuthorized: allowed, context: allowed ? context(r.identity ?? null) : {} };
    // REST API: an IAM policy for this method. A refusal is "Deny" (403); API Gateway has no 401 from a policy.
    return {
      principalId: r.identity?.sub ?? (allowed ? 'probaline-report-only' : 'anonymous'),
      policyDocument: { Version: '2012-10-17', Statement: [{ Action: 'execute-api:Invoke', Effect: allowed ? 'Allow' : 'Deny', Resource: event.methodArn ?? event.routeArn ?? '*' }] },
      context: allowed ? context(r.identity ?? null) : {},
    };
  };
}

/** The handler to deploy: configured from the environment. */
export const handler = (event: Event) => {
  handlerImpl ??= createAuthorizer({
    issuer: process.env.PROBALINE_ISSUER ?? '',
    audience: process.env.PROBALINE_AUDIENCE ?? '',
    reportOnly: process.env.PROBALINE_REPORT_ONLY === 'true',
  });
  return handlerImpl(event);
};
let handlerImpl: ReturnType<typeof createAuthorizer> | undefined;
