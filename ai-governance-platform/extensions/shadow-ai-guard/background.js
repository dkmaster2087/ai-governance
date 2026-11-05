/**
 * Probaline Shadow AI Guard: service worker.
 * Records visits to AI tools (domain only), blocks the tools the company decided to block, and reports to
 * the Probaline gateway. Settings come from Chrome policy (IT), then the gateway, then the popup (testing only).
 */
import {
  BATCH, MAX_QUEUE, blockingRules, effectiveConfig, isManaged, pruneSeen, sighting,
} from './lib.js';

const SYNC_MINUTES = 5;

/** In memory for this wake of the service worker; everything that matters is also in storage. */
let state = null;

async function load() {
  const [stored, managed] = await Promise.all([
    chrome.storage.local.get(['local', 'remote', 'queue', 'lastSeen', 'deviceId', 'lastSync', 'lastReport']),
    chrome.storage.managed.get(null).catch(() => ({})),
  ]);
  let deviceId = stored.deviceId;
  if (!deviceId) {
    deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
    await chrome.storage.local.set({ deviceId });
  }
  state = {
    managed: managed || {},
    local: stored.local || {},
    remote: stored.remote || {},
    queue: stored.queue || [],
    lastSeen: pruneSeen(stored.lastSeen || {}),
    deviceId,
    lastSync: stored.lastSync || null,
    lastReport: stored.lastReport || null,
    user: deviceId,
  };
  state.config = effectiveConfig(state);
  state.user = await whoIsThis();
  return state;
}

/** The Chrome profile's work email when IT turned that on; otherwise this install's random ID. */
async function whoIsThis() {
  if (!state.config.identifyUsers || !chrome.identity?.getProfileUserInfo) return state.deviceId;
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    return info?.email || state.deviceId;
  } catch {
    return state.deviceId;
  }
}

// Service workers are stopped when idle and globals reset, so every handler waits for this.
let ready = load();
const current = () => ready;

async function applyRules() {
  const { config } = await current();
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: blockingRules(config),
  });
}

async function api(path, init = {}) {
  const { config } = await current();
  if (!config.gatewayUrl || !config.apiKey) return null;
  return fetch(`${config.gatewayUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.apiKey}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
}

/** Fetch the company's decisions (mode, blocked and approved tools, block page). */
async function syncConfig() {
  try {
    const res = await api('/v1/shadow-ai/config');
    if (!res?.ok) return;
    const remote = await res.json();
    const s = await current();
    s.remote = remote;
    s.lastSync = new Date().toISOString();
    s.config = effectiveConfig(s);
    await chrome.storage.local.set({ remote, lastSync: s.lastSync });
    await applyRules();
  } catch (err) {
    console.warn('[Probaline] Settings sync failed; keeping the last ones', err.message);
  }
}

async function report() {
  const s = await current();
  if (s.queue.length === 0) return;
  try {
    const batch = s.queue.slice(0, BATCH);
    const res = await api('/v1/shadow-ai/events', { method: 'POST', body: JSON.stringify({ events: batch }) });
    if (!res?.ok) return;
    s.queue = s.queue.slice(batch.length);
    s.lastReport = new Date().toISOString();
    await chrome.storage.local.set({ queue: s.queue, lastReport: s.lastReport });
  } catch (err) {
    console.warn('[Probaline] Report failed; will retry', err.message);
  }
}

async function refresh() {
  ready = load();
  await ready;
  await applyRules();
  await syncConfig();
  await report();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  refresh();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  refresh();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') current().then(syncConfig).then(report);
});
// IT changed the policy, or the popup saved test settings.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'managed' || (area === 'local' && changes.local)) refresh();
});

// Record sightings. Registered at the top level so Chrome can wake the worker for them.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    current().then(async (s) => {
      const evt = sighting(details, s.config, { lastSeen: s.lastSeen, user: s.user });
      if (!evt) return;
      s.queue.push(evt);
      if (s.queue.length > MAX_QUEUE) s.queue = s.queue.slice(-MAX_QUEUE);
      await chrome.storage.local.set({ queue: s.queue, lastSeen: s.lastSeen });
    });
  },
  { urls: ['<all_urls>'] }
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'STATUS') {
    current().then((s) => sendResponse({
      managed: isManaged(s.managed),
      configured: Boolean(s.config.gatewayUrl && s.config.apiKey),
      gatewayUrl: s.config.gatewayUrl,
      mode: s.config.mode,
      blocked: s.config.enforcedDomains,
      links: s.config.blockPage?.links ?? [],
      queued: s.queue.length,
      lastSync: s.lastSync,
      lastReport: s.lastReport,
      identifyUsers: s.config.identifyUsers,
    }));
    return true;
  }
  if (msg?.type === 'SYNC_NOW') {
    refresh().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
