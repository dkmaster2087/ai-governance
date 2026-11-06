/** The few pages a person sees while signing an agent in: plain HTML, no scripts. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Probaline</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --card:#fff; --ink:#16181d; --muted:#5d6370; --line:#dcdad3; --accent:#16181d; --accent-ink:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111214; --card:#1a1c20; --ink:#ecebe8; --muted:#a3a7b0; --line:#30333a; --accent:#ecebe8; --accent-ink:#111214; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px 16px; background:var(--bg); color:var(--ink);
         font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width:100%; max-width:460px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px 26px; }
  .brand { font-weight:700; letter-spacing:-0.01em; color:var(--muted); font-size:14px; margin:0 0 18px; }
  h1 { font-size:22px; line-height:1.25; margin:0 0 12px; letter-spacing:-0.01em; }
  p { margin:0 0 12px; color:var(--muted); }
  dl { margin:16px 0 20px; display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:14px; }
  dt { color:var(--muted); } dd { margin:0; word-break:break-word; }
  .row { display:flex; gap:10px; flex-wrap:wrap; }
  button { font:inherit; font-weight:600; min-height:44px; padding:0 20px; border-radius:10px; cursor:pointer; border:1px solid var(--accent); }
  .yes { background:var(--accent); color:var(--accent-ink); } .no { background:transparent; color:var(--ink); border-color:var(--line); }
  code { font-size:13px; }
</style></head>
<body><main><p class="brand">Probaline</p>${body}</main></body></html>`;

export function consentPage(o: { action: string; rid: string; token: string; client: string; redirectHost: string; who: string; server: string }) {
  return shell('Allow access', `
  <h1>${esc(o.client)} wants to use ${esc(o.server)} as you</h1>
  <p>It will be able to call the tools you have access to. Every call is checked against your company's rules and recorded.</p>
  <dl><dt>Signed in as</dt><dd>${esc(o.who)}</dd><dt>Agent</dt><dd>${esc(o.client)}</dd><dt>Sends you back to</dt><dd><code>${esc(o.redirectHost)}</code></dd></dl>
  <p>Only allow this if you started connecting this agent just now.</p>
  <form method="post" action="${esc(o.action)}" class="row">
    <input type="hidden" name="rid" value="${esc(o.rid)}"><input type="hidden" name="token" value="${esc(o.token)}">
    <button class="yes" name="decision" value="allow" type="submit">Allow</button>
    <button class="no" name="decision" value="deny" type="submit">Don't allow</button>
  </form>`);
}

export function messagePage(title: string, message: string) {
  return shell(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p><p>You can close this window.</p>`);
}
