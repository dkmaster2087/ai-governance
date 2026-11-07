import { Findings, PathFinding, Recommendation, ShareHistoryEntry, isPerson } from './findings';

/** Everything goes through this; the report must never run anything from a log. */
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number) => x.toLocaleString('en-US');
const plural = (k: number, one: string, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const bytes = (b?: number) => (b === undefined ? '' : b < 1e6 ? `${Math.round(b / 1e3)} KB` : b < 1e9 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e9).toFixed(2)} GB`);

const CATEGORY: Record<string, string> = {
  chat: 'Chat app', model_api: 'Model API', coding: 'Coding assistant', cloud_ai: 'Cloud AI service', work_app: 'AI in a work app',
};
const KIND: Record<string, string> = { api: 'apps', browser: 'browsers', cloud_ai: 'cloud' };

function trend(t: { first: number; second: number }): string {
  if (t.first === 0 && t.second === 0) return '';
  if (t.first === 0) return 'new';
  const change = (t.second - t.first) / t.first;
  if (Math.abs(change) < 0.1) return 'steady';
  return `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`;
}

export interface ReportOptions {
  /** Real names for pseudonyms, from the customer's private lookup. Only used when they ask for it locally. */
  names?: Record<string, string>;
  company?: string;
}

function rec(r: Recommendation): string {
  return `<article class="rec ${r.priority}">
    <p class="pri">${r.priority === 'high' ? 'Do first' : r.priority === 'medium' ? 'Next' : 'Later'}</p>
    <h3>${esc(r.title)}</h3>
    <p>${esc(r.why)}</p>
    <p><strong>What to do:</strong> ${esc(r.action)}</p>
    ${r.items.length ? `<ul>${r.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
  </article>`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One path's share through Probaline, the earlier shares, and who still goes around it. */
function pathCard(p: PathFinding, history: ShareHistoryEntry[], who: (w: string) => string): string {
  const earlier = history.filter((h) => h.shares[p.id] !== undefined).map((h) => `${day(h.to)}: ${pct(h.shares[p.id]!)}`);
  const total = p.through + p.direct;
  const otherSources = p.sources.filter((x) => x.label !== p.measuredBy);
  return `<article class="path">
    <div class="share">
      <b class="${p.gatewaySeen ? '' : 'flag'}">${p.share === null ? '–' : pct(p.share)}</b>
      <span>through Probaline</span>
    </div>
    <div class="path-body">
      <h3>${esc(p.title)}</h3>
      <p class="muted">${esc(n(p.through))} of ${esc(plural(total, 'lookup or call', 'lookups and calls'))} in ${esc(p.measuredBy)}.${earlier.length ? ` Earlier reports: ${esc(earlier.join(' · '))}.` : ''}</p>
      ${otherSources.length ? `<p class="muted">Other sources: ${otherSources.map((x) => `${esc(x.label)} ${esc(pct(x.share))}`).join('; ')}. Each source counts in its own units, so they aren’t added together.</p>` : ''}
      ${p.gatewaySeen ? '' : '<p class="note">No traffic from the Probaline gateway was seen on this path. If the gateway runs here, name it with <code>--gateway</code> (for example <code>role:probaline-gateway-task</code> or its outbound IP address) and run the collector again.</p>'}
      ${p.stillDirectCount === 0 ? '<p><strong>Nothing goes around Probaline on this path.</strong></p>' : `<p><strong>Still going direct: ${esc(plural(p.stillDirectCount, 'caller'))}</strong></p>
      ${[false, true].map((people) => p.stillDirect.slice(0, 10).find((c) => isPerson(c.who) === people))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => `<p><strong>${isPerson(c.who) ? 'For people' : 'For apps and workloads'}:</strong> ${esc(c.fix)}</p>`).join('')}
      <div class="scroll"><table><thead><tr><th>Caller</th><th>Services</th><th>Lookups and calls</th></tr></thead><tbody>
      ${p.stillDirect.slice(0, 10).map((c) => `<tr><td><code>${esc(who(c.who))}</code></td><td>${esc(c.services.join(', '))}</td><td class="num">${n(c.count)}</td></tr>`).join('')}
      </tbody></table></div>${p.stillDirectCount > 10 ? `<p class="muted">And ${n(p.stillDirectCount - 10)} more in the findings file.</p>` : ''}`}
    </div>
  </article>`;
}

/** A self-contained HTML report: no scripts, no external files, safe to email or archive. */
export function renderReport(f: Findings, opts: ReportOptions = {}): string {
  const who = (w: string) => (isPerson(w) && opts.names?.[w] ? `${opts.names[w]}` : w);
  const t = f.totals;
  const headline = t.count === 0
    ? `No AI traffic found between ${day(f.from)} and ${day(f.to)}.`
    : `${plural(t.services, 'AI service')} used from ${[t.machines ? plural(t.machines, 'server or device', 'servers and devices') : '', t.people ? plural(t.people, 'person', 'people') : ''].filter(Boolean).join(' and ')}.`;

  const table = (head: string[], rows: string[][]) => rows.length === 0 ? '<p class="muted">None found.</p>' : `<div class="scroll"><table>
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI usage assessment${opts.company ? ` · ${esc(opts.company)}` : ''}</title>
<style>
:root{--ink:#14213D;--soft:#2B3550;--muted:#5B6478;--line:#E3E6EC;--canvas:#F6F7F9;--stop:#C8322A;--stop-soft:#FBEDEC}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:34px;line-height:1.15;letter-spacing:-.02em;margin:6px 0 10px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:40px 0 12px}
h3{font-size:18px;margin:2px 0 6px}.eyebrow{margin:0;color:var(--muted);font-size:13px}.muted{color:var(--muted)}
.lead{color:var(--soft);font-size:17px;margin:0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:24px}
.stat{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}.stat b{display:block;font-size:26px}.stat span{color:var(--muted);font-size:13px}
.panel{background:#fff;border:1px solid var(--line);border-radius:12px;padding:6px 18px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:10px 8px}
td{padding:10px 8px;border-top:1px solid var(--line);vertical-align:top}td.num{font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:nowrap}
code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;overflow-wrap:anywhere}
.flag{color:var(--stop);font-weight:600}.rec{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:12px}
.rec.high{border-left:4px solid var(--stop)}.pri{margin:0;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}.rec.high .pri{color:var(--stop)}
.path{display:flex;gap:20px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 20px;margin-bottom:12px}
.share{flex:0 0 120px}.share b{display:block;font-size:40px;line-height:1.1;letter-spacing:-.02em}.share span{color:var(--muted);font-size:13px}
.path-body{flex:1;min-width:0}.path-body p{margin:6px 0}.note{background:var(--stop-soft);border-radius:8px;padding:8px 12px}
@media (max-width:600px){.path{flex-direction:column;gap:6px}.share{flex-basis:auto}}
.rec ul{margin:8px 0 0;padding-left:18px;color:var(--soft)}.rec li{overflow-wrap:anywhere}
footer{margin-top:48px;color:var(--muted);font-size:13px}
@media print{body{background:#fff}.panel,.rec,.stat{break-inside:avoid}}
</style></head>
<body><main>
<p class="eyebrow">AI usage assessment${opts.company ? ` · ${esc(opts.company)}` : ''} · ${esc(day(f.from))} to ${esc(day(f.to))}</p>
<h1>${esc(headline)}</h1>
<p class="lead">${t.noTermsServices ? `<span class="flag">${esc(plural(t.noTermsServices, 'service has', 'services have'))} no business data terms on record.</span> ` : ''}${f.directApi.length ? `${esc(plural(f.directApi.length, 'server or app calls', 'servers and apps call'))} model APIs directly, with no policy in the way.` : ''}</p>

<div class="stats">
  <div class="stat"><b>${n(t.services)}</b><span>AI services</span></div>
  <div class="stat"><b>${n(t.machines)}</b><span>servers and devices</span></div>
  <div class="stat"><b>${n(t.people)}</b><span>people (pseudonymous)</span></div>
  <div class="stat"><b>${n(t.count)}</b><span>lookups and calls</span></div>
</div>

<h2>Share through Probaline</h2>
${f.paths.length
    ? f.paths.map((p) => pathCard(p, f.history ?? [], who)).join('')
    : '<p class="muted">No apps or cloud workloads calling AI were found in these logs. Browser use is in its own section below.</p>'}

<h2>Recommendations</h2>
${f.recommendations.length ? f.recommendations.map(rec).join('') : '<p class="muted">Nothing to recommend from these logs.</p>'}

<h2>AI services found</h2>
<div class="panel">${table(['Service', 'Type', 'Reached from', 'Users or devices', 'Lookups and calls', 'Trend', 'Business terms'], f.services.map((s) => [
    `<strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.vendor)}</span>`,
    esc(CATEGORY[s.category] ?? s.category),
    esc(s.kinds.map((k) => KIND[k] ?? k).join(', ')),
    `<span class="num">${n(s.people + s.machines)}</span>`,
    `<span class="num">${n(s.count)}</span>`,
    esc(trend(s.trend)),
    s.businessTerms === 'offered' ? 'Offered' : '<span class="flag">None on record</span>',
  ]))}</div>

<h2>Servers and apps calling model APIs directly</h2>
<div class="panel">${(() => {
    // Only some logs carry data volume; show the column when any caller has it.
    const sent = f.directApi.some((c) => c.bytesOut !== undefined);
    return table(['Caller', 'Services', 'Calls', ...(sent ? ['Sent'] : [])], f.directApi.slice(0, 50).map((c) => [
      `<code>${esc(who(c.who))}</code>`, esc(c.services.join(', ')), `<span class="num">${n(c.count)}</span>`,
      ...(sent ? [`<span class="num">${esc(bytes(c.bytesOut))}</span>`] : []),
    ]));
  })()}${f.directApi.length > 50 ? `<p class="muted">And ${n(f.directApi.length - 50)} more.</p>` : ''}</div>

<h2>Cloud AI services used directly</h2>
<div class="panel">${table(['Identity', 'Services', 'Calls'], f.cloudAi.slice(0, 50).map((c) => [
    `<code>${esc(who(c.who))}</code>`, esc(c.services.join(', ')), `<span class="num">${n(c.count)}</span>`,
  ]))}</div>

<h2>AI tools used in browsers</h2>
<div class="panel">${table(['Tool', 'People', 'Devices', 'Visits'], f.browser.map((b) => [
    `<strong>${esc(b.service)}</strong>`, `<span class="num">${n(b.people)}</span>`, `<span class="num">${n(b.machines)}</span>`, `<span class="num">${n(b.count)}</span>`,
  ]))}</div>

<h2>What was read</h2>
<div class="panel">${table(['Source', 'Days', 'Matches', 'What it can’t see'], f.sources.map((s) => [
    `<strong>${esc(s.label)}</strong><br><span class="muted">${esc(day(s.firstDay))} to ${esc(day(s.lastDay))}</span>`,
    `<span class="num">${n(s.days)}</span>`, `<span class="num">${n(s.count)}</span>`, esc(s.limits ?? ''),
  ]))}</div>

<footer>
  <p>Built in your environment by the Probaline collector. Only log lines that matched a known AI service were kept, as daily counts; no prompt content, page address or raw log line is in this report.
  ${opts.names ? 'Names are shown because this copy was built with your private name lookup. Don’t share this copy.' : 'People are shown as codes; your team can reveal names with the private lookup kept next to the collector’s results.'}</p>
  <p>AI service catalog ${esc(f.catalogVersion)}. Generated ${esc(new Date(f.generatedAt).toUTCString())}.</p>
</footer>
</main></body></html>
`;
}
