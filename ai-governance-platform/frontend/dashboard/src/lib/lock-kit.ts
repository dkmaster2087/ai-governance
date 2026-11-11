// The verifier code and the laptop scan, bundled into the dashboard from the repository, so what an admin
// copies is exactly what Probaline's tests run.
import nodeSource from '../../../../packages/verify-identity/src/index.ts?raw';
import lambdaSource from '../../../../packages/verify-identity/src/lambda.ts?raw';
import pythonSource from '../../../../packages/verify-identity/snippets/python/probaline_identity.py?raw';
import goSource from '../../../../packages/verify-identity/snippets/go/probaline_identity.go?raw';
import javaSource from '../../../../packages/verify-identity/snippets/java/ProbalineIdentityFilter.java?raw';
import scanSh from '../../../../collector/endpoint/mcp-scan.sh?raw';
import scanPs1 from '../../../../collector/endpoint/mcp-scan.ps1?raw';

export type KitLanguage = 'node' | 'python' | 'lambda' | 'go' | 'java';

export interface KitFile { name: string; body: string }

export interface KitOption {
  id: KitLanguage;
  label: string;
  /** Run against tokens the gateway signs in Probaline's tests. */
  tested: boolean;
  setup: string;
  usage: string;
  files: KitFile[];
}

export const SCAN_SCRIPTS: KitFile[] = [
  { name: 'mcp-scan.sh', body: scanSh },
  { name: 'mcp-scan.ps1', body: scanPs1 },
];

const q = (s: string) => JSON.stringify(s);

export function lockKit(issuer: string, audience: string, reportOnly: boolean): KitOption[] {
  const ro = reportOnly ? 'true' : 'false';
  const roNote = reportOnly ? ' // log calls that didn’t come through Probaline; set false to refuse them' : '';
  return [
    {
      id: 'node', label: 'Node (Express, Fastify)', tested: true,
      setup: 'Save index.ts as probaline-identity/index.ts in your API (no dependencies; Node 18 or later).',
      usage: `import { expressGuard, fastifyGuard } from './probaline-identity';

const probaline = {
  issuer: ${q(issuer)},
  audience: ${q(audience)},
  reportOnly: ${ro},${roNote}
};

// Express
app.use(expressGuard(probaline));
// Fastify
app.addHook('onRequest', fastifyGuard(probaline));

// In a handler: req.probaline.sub, .email, .tool, .rid (Probaline's request ID)`,
      files: [{ name: 'index.ts', body: nodeSource }],
    },
    {
      id: 'python', label: 'Python (FastAPI, Flask)', tested: true,
      setup: 'pip install "pyjwt[crypto]>=2.8", then save probaline_identity.py next to your app.',
      usage: `from probaline_identity import ProbalineIdentity

probaline = ProbalineIdentity(
    issuer=${q(issuer)},
    audience=${q(audience)},
    report_only=${reportOnly ? 'True' : 'False'},
)

# FastAPI
@app.get("/employees/{id}")
def get_employee(id: str, who=Depends(probaline.fastapi_dependency())): ...

# Flask
@app.get("/employees/<id>")
@probaline.flask_required
def get_employee(id): ...  # flask.g.probaline`,
      files: [{ name: 'probaline_identity.py', body: pythonSource }],
    },
    {
      id: 'lambda', label: 'AWS API Gateway', tested: true,
      setup: 'A Lambda authorizer (REQUEST type) for HTTP or REST APIs. Bundle both files: npx esbuild lambda.ts --bundle --platform=node --target=node20 --outfile=dist/index.js',
      usage: `# Lambda settings (environment)
PROBALINE_ISSUER=${issuer}
PROBALINE_AUDIENCE=${audience}
PROBALINE_REPORT_ONLY=${ro}

# Handler: index.handler. Identity source: $request.header.X-Probaline-Identity
# Turn authorizer caching off (or key it on that header): each token names one call.`,
      files: [{ name: 'lambda.ts', body: lambdaSource }, { name: 'index.ts', body: nodeSource }],
    },
    {
      id: 'go', label: 'Go', tested: false,
      setup: 'go get github.com/golang-jwt/jwt/v5 github.com/MicahParks/keyfunc/v3, then add probaline_identity.go to your module.',
      usage: `guard, err := probaline.NewGuard(${q(issuer)}, ${q(audience)}, ${ro})
if err != nil { log.Fatal(err) }
http.Handle("/", guard.Middleware(yourHandler))
// In a handler: who := probaline.FromContext(r.Context())`,
      files: [{ name: 'probaline_identity.go', body: goSource }],
    },
    {
      id: 'java', label: 'Java (Spring)', tested: false,
      setup: 'Needs spring-security-oauth2-jose. Add ProbalineIdentityFilter.java and register it.',
      usage: `@Bean
FilterRegistrationBean<ProbalineIdentityFilter> probaline() {
  return new FilterRegistrationBean<>(new ProbalineIdentityFilter(
      ${q(issuer)}, ${q(audience)}, ${ro}));
}`,
      files: [{ name: 'ProbalineIdentityFilter.java', body: javaSource }],
    },
  ];
}
