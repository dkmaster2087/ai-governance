# @probaline/verify-identity

Lock an API to Probaline: accept only calls that came through a Probaline MCP server, and know who asked.

Every call Probaline makes to an API behind an MCP server carries `X-Probaline-Identity`: an ES256 token the
gateway signs, valid for five minutes, with:

| Claim | Meaning |
|---|---|
| `iss` | The gateway's address (its keys are at `<iss>/.well-known/jwks.json`) |
| `aud` | The API's base URL, exactly as added to the MCP server |
| `sub`, `kind`, `email`, `name`, `groups` | Who asked: `person:<email>` (signed in through the company's identity provider) or `key:<id>` (a workload) |
| `tenant`, `server`, `tool`, `agent` | Which company, MCP server, tool and agent |
| `rid` | Probaline's request ID, the same one in Probaline's evidence |

Header `typ` is `probaline-identity+jwt`. Only ES256 is accepted; `none` and shared-secret tokens never are.

## Use it

Start with `reportOnly: true`: calls without a valid identity are logged, not refused. When the log shows only
Probaline's calls, turn it off. The Enforcement page in the dashboard fills these in for each API.

```ts
import { expressGuard, fastifyGuard } from '@probaline/verify-identity';

const probaline = { issuer: 'https://gateway.acme.example', audience: 'https://hr.acme.example/api', reportOnly: true };
app.use(expressGuard(probaline));                 // Express: req.probaline
app.addHook('onRequest', fastifyGuard(probaline)); // Fastify: request.probaline
```

`createVerifier(options).verify(headerValue)` returns the identity or throws a `VerifyError` with a `code`:
`missing`, `malformed`, `wrong_type`, `unknown_key`, `bad_signature`, `wrong_issuer`, `wrong_audience`,
`expired`, `not_yet_valid`, `keys_unavailable` (answered 503 by the guards; the rest 401).

### AWS API Gateway

`src/lambda.ts` is a REQUEST Lambda authorizer for HTTP APIs (simple responses) and REST APIs (IAM policy).
Settings: `PROBALINE_ISSUER`, `PROBALINE_AUDIENCE`, `PROBALINE_REPORT_ONLY`. Bundle with
`npx esbuild src/lambda.ts --bundle --platform=node --target=node20 --outfile=dist/index.js`, handler
`index.handler`, identity source `$request.header.X-Probaline-Identity`, caching off.

### Other languages

| | File | Tested |
|---|---|---|
| Python (FastAPI, Flask) | `snippets/python/probaline_identity.py` (PyJWT) | Yes, against gateway-signed tokens |
| Go (net/http) | `snippets/go/probaline_identity.go` (golang-jwt, keyfunc) | Not yet |
| Java (Spring) | `snippets/java/ProbalineIdentityFilter.java` (spring-security-oauth2-jose) | Not yet |

## Not covered

- **Replay within five minutes.** A token can be presented again until it expires. For writes that must never
  repeat, keep the `jti` (or `rid`) for five minutes and refuse a second use.
- **Not published to npm yet.** Copy `src/index.ts` (no dependencies), or take the files from the dashboard.

`npm test -w packages/verify-identity`: the Node verifier, the Express and Fastify guards, the Lambda authorizer
and the Python version, all against tokens signed by the gateway's own key code.
