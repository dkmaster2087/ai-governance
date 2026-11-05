import { safeLinks } from './lib.js';

const $ = (id) => document.getElementById(id);
const ago = (iso) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

async function render() {
  const s = await chrome.runtime.sendMessage({ type: 'STATUS' });
  $('mode').textContent = s.mode === 'block' ? 'Blocking unapproved tools' : 'Watching';
  $('summary').textContent = !s.configured
    ? 'Not connected to your company’s Probaline yet.'
    : s.mode === 'block'
      ? 'AI tools your company hasn’t approved are blocked in this browser.'
      : 'This browser tells your company which AI tools are opened. It doesn’t see what you type.';

  const links = safeLinks(s.links);
  const list = $('links');
  list.replaceChildren(...links.map((l) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = l.name;
    li.append(a);
    return li;
  }));
  $('approved').hidden = links.length === 0;

  const facts = [
    ['Managed by', s.managed ? 'Your IT team' : 'Nobody (test setup)'],
    ['Reports as', s.identifyUsers ? 'Your work email' : 'This browser, not you by name'],
    ['Settings checked', ago(s.lastSync)],
    ['Last report', ago(s.lastReport)],
  ];
  $('facts').replaceChildren(...facts.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));

  $('setup').hidden = s.managed;
  if (!s.managed) $('gatewayUrl').value = s.gatewayUrl || '';
}

$('save').addEventListener('click', async () => {
  const { local = {} } = await chrome.storage.local.get('local');
  const key = $('apiKey').value.trim();
  await chrome.storage.local.set({ local: { ...local, gatewayUrl: $('gatewayUrl').value.trim(), ...(key ? { apiKey: key } : {}) } });
  $('apiKey').value = '';
  $('save').textContent = 'Saved';
  setTimeout(() => { $('save').textContent = 'Save'; render(); }, 1200);
});

$('sync').addEventListener('click', async () => {
  $('sync').textContent = 'Checking…';
  await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  $('sync').textContent = 'Check for new settings';
  render();
});

render();
