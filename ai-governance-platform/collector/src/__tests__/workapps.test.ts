import { parseOnpremLine, parseOnpremLines, parseOnpremText } from '../onprem/parsers';
import { serviceForAppName } from '../core/catalog';

const NOW = new Date('2026-11-05T12:00:00Z');
const j = (o: object) => JSON.stringify(o);
const ids = (text: string) => [...parseOnpremText(text, NOW)].map((o) => `${o.service}|${o.who.value}|${o.source}`);

describe('app names', () => {
  it.each([
    ['ChatGPT Enterprise', 'chatgpt'], ['Claude for Work (prod)', 'claude'], ['GitHub Copilot Business', 'github-copilot'],
    ['Microsoft 365 Copilot', 'm365-copilot'], ['Cursor', 'cursor'], ['Perplexity Enterprise Pro', 'perplexity'],
    ['Gemini for Google Workspace', 'gemini-workspace'], ['Windsurf', 'codeium'],
  ])('%s is %s', (name, id) => expect(serviceForAppName(name)?.id).toBe(id));

  it.each(['Precursor', 'Salesforce', 'Copilot Fleet Tracking', 'Poetry Club', ''])('%s is not an AI app', (name) => {
    expect(serviceForAppName(name)).toBeUndefined();
  });
});

describe('Microsoft 365', () => {
  const copilot = { CreationTime: '2026-11-05T09:00:00', Id: '1', Operation: 'CopilotInteraction', RecordType: 261, UserId: 'j.doe@acme.example', Workload: 'Copilot', CopilotEventData: { AppHost: 'Word' } };

  it('counts Copilot interactions per person, times read as UTC', () => {
    expect(parseOnpremLine(j(copilot), NOW)).toEqual({ time: '2026-11-05T09:00:00Z', service: 'm365-copilot', kind: 'browser', who: { type: 'user', value: 'j.doe@acme.example' }, source: 'm365_audit' });
  });

  it('counts other AI apps Purview watches, by name', () => {
    const r = { ...copilot, Operation: 'AIAppInteraction', CopilotEventData: { AppIdentity: { DisplayName: 'ChatGPT Enterprise' } } };
    expect(parseOnpremLine(j(r), NOW)?.service).toBe('chatgpt');
    expect(parseOnpremLine(j({ ...r, CopilotEventData: { AppIdentity: { DisplayName: 'Contoso HR' } } }), NOW)).toBeNull();
  });

  it('ignores other audit operations', () => {
    expect(parseOnpremLine(j({ ...copilot, Operation: 'FileAccessed', Workload: 'SharePoint' }), NOW)).toBeNull();
  });

  it('reads a Management Activity API response and a Purview CSV export', () => {
    expect(ids(JSON.stringify([copilot, { ...copilot, UserId: 'm.chen@acme.example' }]))).toEqual([
      'm365-copilot|j.doe@acme.example|m365_audit', 'm365-copilot|m.chen@acme.example|m365_audit',
    ]);
    const auditData = JSON.stringify(copilot).replace(/"/g, '""');
    const csv = `RecordId,CreationDate,RecordType,Operation,UserId,AuditData\n1,2026-11-05T09:00:00,CopilotInteraction,CopilotInteraction,j.doe@acme.example,"${auditData}"`;
    expect(ids(csv)).toEqual(['m365-copilot|j.doe@acme.example|m365_audit']);
  });
});

describe('Google Workspace', () => {
  const activity = (applicationName: string, events: object[], email = 'priya@acme.example') => ({
    kind: 'admin#reports#activity', id: { time: '2026-11-05T10:00:00.000Z', uniqueQualifier: '1', applicationName, customerId: 'C01' },
    actor: { email, profileId: '1' }, ipAddress: '203.0.113.9', events,
  });

  it('counts apps given access to Google data (OAuth), matched by name', () => {
    const a = activity('token', [{ type: 'auth', name: 'authorize', parameters: [{ name: 'app_name', value: 'ChatGPT' }, { name: 'scope', multiValue: ['https://www.googleapis.com/auth/drive.readonly'] }] }]);
    expect(parseOnpremLine(j(a), NOW)).toEqual({ time: '2026-11-05T10:00:00.000Z', service: 'chatgpt', kind: 'browser', who: { type: 'user', value: 'priya@acme.example' }, source: 'gws_oauth' });
    const other = activity('token', [{ type: 'auth', name: 'authorize', parameters: [{ name: 'app_name', value: 'Zoom' }] }]);
    expect(parseOnpremLines(j(other), NOW)).toEqual([]);
  });

  it('counts SSO to AI apps and Gemini activity, one finding per event', () => {
    const sso = activity('saml', [{ type: 'login', name: 'login_success', parameters: [{ name: 'application_name', value: 'Claude for Work' }] }]);
    expect(parseOnpremLine(j(sso), NOW)).toMatchObject({ service: 'claude', source: 'gws_sso' });
    const gemini = activity('gemini_in_workspace_apps', [{ name: 'feature_utilization' }, { name: 'feature_utilization' }]);
    expect(parseOnpremLines(j(gemini), NOW).map((o) => o.service)).toEqual(['gemini-workspace', 'gemini-workspace']);
  });

  it('reads a Reports API response', () => {
    const doc = { kind: 'admin#reports#activities', items: [activity('token', [{ name: 'authorize', parameters: [{ name: 'app_name', value: 'Claude' }] }])] };
    expect(ids(JSON.stringify(doc))).toEqual(['claude|priya@acme.example|gws_oauth']);
  });
});

describe('Okta', () => {
  const event = (eventType: string, app: string, result = 'SUCCESS') => ({
    uuid: 'u', published: '2026-11-05T08:30:00.000Z', eventType, displayMessage: 'x',
    actor: { type: 'User', alternateId: 's.ortiz@acme.example' }, client: { ipAddress: '198.51.100.4' }, outcome: { result },
    target: [{ type: 'AppInstance', alternateId: app, displayName: app }, { type: 'AppUser', alternateId: 's.ortiz' }],
  });

  it('counts single sign-on to AI apps', () => {
    expect(parseOnpremLine(j(event('user.authentication.sso', 'ChatGPT Enterprise')), NOW))
      .toEqual({ time: '2026-11-05T08:30:00.000Z', service: 'chatgpt', kind: 'browser', who: { type: 'user', value: 's.ortiz@acme.example' }, source: 'okta_sso' });
  });

  it('skips failures, other apps and other events', () => {
    expect(parseOnpremLine(j(event('user.authentication.sso', 'ChatGPT Enterprise', 'FAILURE')), NOW)).toBeNull();
    expect(parseOnpremLine(j(event('user.authentication.sso', 'Workday')), NOW)).toBeNull();
    expect(parseOnpremLine(j(event('user.session.start', 'ChatGPT Enterprise')), NOW)).toBeNull();
  });

  it('reads a System Log API response', () => {
    expect(ids(JSON.stringify([event('user.authentication.sso', 'Cursor'), event('app.oauth2.as.consent.grant', 'Claude')]))).toEqual([
      'cursor|s.ortiz@acme.example|okta_sso', 'claude|s.ortiz@acme.example|okta_consent',
    ]);
  });
});

describe('Microsoft Entra ID', () => {
  const signIn = { id: 's1', createdDateTime: '2026-11-05T07:00:00Z', userPrincipalName: 'l.wu@acme.example', appDisplayName: 'ChatGPT', appId: 'a', ipAddress: '192.0.2.8', status: { errorCode: 0 } };

  it('reads Graph sign-ins and skips failed ones', () => {
    expect(ids(JSON.stringify({ '@odata.context': 'x', value: [signIn, { ...signIn, status: { errorCode: 50126 } }, { ...signIn, appDisplayName: 'Office 365 Exchange Online' }] })))
      .toEqual(['chatgpt|l.wu@acme.example|entra_signin']);
  });

  it('reads sign-ins sent through a diagnostic setting', () => {
    const r = { time: '2026-11-05T07:05:00Z', resourceId: '/tenants/t1/providers/Microsoft.aadiam', category: 'SignInLogs', operationName: 'Sign-in activity',
      properties: { userPrincipalName: 'l.wu@acme.example', appDisplayName: 'Claude', ipAddress: '192.0.2.8', status: { errorCode: 0 } } };
    expect(parseOnpremLine(j(r), NOW)).toMatchObject({ time: '2026-11-05T07:05:00Z', service: 'claude', source: 'entra_signin' });
  });

  it('counts consent to AI apps from audit logs', () => {
    const audit = { activityDateTime: '2026-11-05T07:10:00Z', activityDisplayName: 'Consent to application', result: 'success',
      initiatedBy: { user: { userPrincipalName: 'k.ng@acme.example' } }, targetResources: [{ type: 'ServicePrincipal', displayName: 'Perplexity' }] };
    expect(parseOnpremLine(j(audit), NOW)).toEqual({ time: '2026-11-05T07:10:00Z', service: 'perplexity', kind: 'browser', who: { type: 'user', value: 'k.ng@acme.example' }, source: 'entra_consent' });
    expect(parseOnpremLine(j({ ...audit, activityDisplayName: 'Add user' }), NOW)).toBeNull();
  });
});

describe('any other identity provider', () => {
  it('reads a CSV sign-in export by its columns (OneLogin style)', () => {
    const csv = ['Created At,User,App,Event,IP Address', '2026-11-05 06:00:00,t.ray@acme.example,ChatGPT Enterprise,login,10.0.0.1', '2026-11-05 06:01:00,t.ray@acme.example,Salesforce,login,10.0.0.1'].join('\n');
    expect(ids(csv)).toEqual(['chatgpt|t.ray@acme.example|idp_signin']);
  });

  it('reads JSON lines and JSON arrays (Auth0 / JumpCloud style), skipping failures', () => {
    const lines = [j({ date: '2026-11-05T06:10:00Z', user_name: 'z.ali@acme.example', client_name: 'Claude', type: 's' }),
      j({ timestamp: '2026-11-05T06:11:00Z', username: 'z.ali', application: 'Cursor', success: false })].join('\n');
    expect(ids(lines)).toEqual(['claude|z.ali@acme.example|idp_signin']);
    expect(ids(JSON.stringify([{ time: 1793858400, email: 'a@acme.example', application_name: 'Perplexity' }]))).toEqual(['perplexity|a@acme.example|idp_signin']);
  });

  it('does not take Netskope or Zscaler events for sign-ins', () => {
    const netskope = j({ timestamp: 1793869500, type: 'page', user: 'jdoe@acme.example', app: 'ChatGPT', domain: 'chatgpt.com', appcategory: 'Generative AI', ur_normalized: 'jdoe@acme.example' });
    expect(parseOnpremLine(netskope, NOW)?.source).toBe('netskope');
  });
});
