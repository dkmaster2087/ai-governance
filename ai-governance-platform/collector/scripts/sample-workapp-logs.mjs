#!/usr/bin/env node
// Made-up work-app and identity logs, each in the shape its product exports. Nothing here is real.
//   m365/management-api.json        Office 365 Management Activity API content (JSON array)
//   m365/purview-export.csv         Purview audit search export (AuditData column)
//   workspace/reports-token.json    Google Reports API, OAuth grants (token application)
//   workspace/reports-gemini.json   Google Reports API, Gemini activity
//   okta/system-log.json            Okta System Log API (JSON array)
//   entra/signins.json              Microsoft Graph auditLogs/signIns
//   entra/audit.json                Microsoft Graph directoryAudits (consent)
//   other-idp/onelogin-export.csv   a CSV sign-in export from another identity provider
// Usage: node collector/scripts/sample-workapp-logs.mjs <out-dir> [days=14]
import fs from 'node:fs';
import path from 'node:path';

const [out, d] = process.argv.slice(2);
if (!out) { console.error('usage: sample-workapp-logs.mjs <out-dir> [days]'); process.exit(1); }
const days = Number(d || 14);
let seed = 31;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const people = ['j.doe', 'm.chen', 'priya', 'sam', 'fatima', 'tom', 'nadia', 'ravi', 'k.ng', 'l.wu'].map((u) => `${u}@acme.example`);
const aiApps = ['ChatGPT Enterprise', 'Claude for Work', 'Cursor', 'Perplexity', 'GitHub Copilot', 'Otter.ai'];
const otherApps = ['Salesforce', 'Workday', 'Zoom', 'Slack', 'Atlassian Cloud'];
const app = () => (rand() < 0.45 ? pick(aiApps) : pick(otherApps));
const end = Date.now();
const at = () => new Date(end - rand() * days * 86400000);
const n = (k) => Math.round(days * k);

const write = (file, body) => { fs.mkdirSync(path.join(out, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(out, file), body); };

// Microsoft 365
const m365 = Array.from({ length: n(40) }, (_, i) => {
  const t = at();
  const copilot = rand() < 0.8;
  return { CreationTime: t.toISOString().slice(0, 19), Id: `m${i}`, Operation: copilot ? 'CopilotInteraction' : pick(['AIAppInteraction', 'FileAccessed']),
    RecordType: copilot ? 261 : 6, UserId: pick(people), Workload: copilot ? 'Copilot' : 'SharePoint',
    CopilotEventData: copilot ? { AppHost: pick(['Word', 'Teams', 'Outlook', 'Excel', 'BizChat']) } : { AppIdentity: { DisplayName: pick(['ChatGPT Enterprise', 'Contoso HR']) } } };
});
write('m365/management-api.json', JSON.stringify(m365.slice(0, Math.floor(m365.length / 2))));
const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
write('m365/purview-export.csv', ['RecordId,CreationDate,RecordType,Operation,UserId,AuditData',
  ...m365.slice(Math.floor(m365.length / 2)).map((r) => [r.Id, r.CreationTime, r.RecordType, r.Operation, r.UserId, q(JSON.stringify(r))].join(','))].join('\n') + '\n');

// Google Workspace
const activity = (applicationName, t, email, events) => ({ kind: 'admin#reports#activity', id: { time: t.toISOString(), uniqueQualifier: String(Math.floor(rand() * 1e9)), applicationName, customerId: 'C01abcd' }, actor: { email, profileId: '1' }, ipAddress: '203.0.113.9', events });
write('workspace/reports-token.json', JSON.stringify({ kind: 'admin#reports#activities', items: Array.from({ length: n(10) }, () =>
  activity('token', at(), pick(people), [{ type: 'auth', name: 'authorize', parameters: [{ name: 'app_name', value: rand() < 0.5 ? pick(['ChatGPT', 'Claude', 'Otter.ai', 'Perplexity']) : pick(otherApps) }, { name: 'scope', multiValue: ['https://www.googleapis.com/auth/drive.readonly'] }] }])) }));
write('workspace/reports-gemini.json', JSON.stringify({ kind: 'admin#reports#activities', items: Array.from({ length: n(25) }, () =>
  activity('gemini_in_workspace_apps', at(), pick(people), [{ type: 'feature_utilization', name: 'feature_utilization', parameters: [{ name: 'app_name', value: pick(['gmail', 'docs', 'meet']) }] }])) }));

// Okta
write('okta/system-log.json', JSON.stringify(Array.from({ length: n(60) }, (_, i) => {
  const a = app();
  return { uuid: `o${i}`, published: at().toISOString(), eventType: rand() < 0.9 ? 'user.authentication.sso' : 'app.oauth2.as.consent.grant', displayMessage: 'User single sign on to app',
    actor: { type: 'User', alternateId: pick(people) }, client: { ipAddress: '198.51.100.4' }, outcome: { result: rand() < 0.95 ? 'SUCCESS' : 'FAILURE' },
    target: [{ type: 'AppInstance', alternateId: a, displayName: a }] };
})));

// Entra
write('entra/signins.json', JSON.stringify({ '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#auditLogs/signIns', value: Array.from({ length: n(50) }, (_, i) => ({
  id: `s${i}`, createdDateTime: at().toISOString(), userPrincipalName: pick(people), appDisplayName: rand() < 0.4 ? pick(['ChatGPT', 'Claude', 'Cursor', 'Microsoft 365 Copilot']) : pick(['Office 365 Exchange Online', 'Microsoft Teams', 'Azure Portal']),
  appId: 'a', ipAddress: '192.0.2.8', status: { errorCode: rand() < 0.95 ? 0 : 50126 } })) }));
write('entra/audit.json', JSON.stringify({ value: Array.from({ length: n(3) }, () => ({ activityDateTime: at().toISOString(), activityDisplayName: 'Consent to application', result: 'success',
  initiatedBy: { user: { userPrincipalName: pick(people) } }, targetResources: [{ type: 'ServicePrincipal', displayName: pick(['ChatGPT', 'Perplexity', 'Fireflies.ai', 'Calendly']) }] })) }));

// Another identity provider
write('other-idp/onelogin-export.csv', ['Created At,User,App,Status,IP Address', ...Array.from({ length: n(30) }, () =>
  `${at().toISOString().replace('T', ' ').slice(0, 19)},${pick(people)},${app()},${rand() < 0.95 ? 'success' : 'failed'},10.0.0.${Math.floor(rand() * 200)}`)].join('\n') + '\n');

console.log(`Wrote sample work-app and identity logs to ${out}`);
