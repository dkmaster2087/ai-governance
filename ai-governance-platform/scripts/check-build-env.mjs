#!/usr/bin/env node
/**
 * Refuse to build a front end for a deployed environment without the settings it needs, instead of shipping
 * a site whose links point at localhost or whose sign-in can't work.
 *
 *   node scripts/check-build-env.mjs website|dashboard|docs
 */
const site = process.argv[2];
const NEEDS = {
  dashboard: ['VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID', 'VITE_GATEWAY_PUBLIC_URL'],
  website: ['VITE_API_URL', 'VITE_DASHBOARD_URL'],
  docs: ['VITE_API_URL', 'VITE_DASHBOARD_URL'],
};
if (!NEEDS[site]) {
  console.error(`Unknown site "${site}". Use website, dashboard or docs.`);
  process.exit(2);
}
const problems = [];
for (const name of NEEDS[site]) {
  const v = process.env[name] ?? '';
  if (!v || v === 'None') problems.push(`${name} is not set`);
  else if (/localhost|127\.0\.0\.1/.test(v)) problems.push(`${name} points at ${v}`);
}
if (site === 'dashboard' && process.env.VITE_AUTH_MODE === 'dev') problems.push('VITE_AUTH_MODE=dev would enable the demo accounts');
if (problems.length) {
  console.error(`Not building the ${site} for a deployed environment:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`${site}: build settings look right.`);
