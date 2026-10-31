import { effectiveConfig, safeLinks } from './lib.js';

const params = new URLSearchParams(location.search);
const domain = (params.get('domain') || '').replace(/[^a-z0-9.-]/gi, '');
if (domain) document.getElementById('domain').textContent = domain;

const [stored, managed] = await Promise.all([
  chrome.storage.local.get(['remote']),
  chrome.storage.managed.get(null).catch(() => ({})),
]);
const config = effectiveConfig({ remote: stored.remote, managed });
document.getElementById('message').textContent = config.blockPage?.message || '';

const links = safeLinks(config.blockPage?.links);
if (links.length) {
  const list = document.getElementById('links');
  for (const l of links) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = l.url;
    a.textContent = l.name;
    const host = document.createElement('span');
    host.textContent = new URL(l.url).hostname;
    li.append(a, host);
    list.append(li);
  }
  document.getElementById('approved').hidden = false;
}
