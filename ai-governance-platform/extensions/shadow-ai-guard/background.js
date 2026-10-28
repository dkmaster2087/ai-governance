/**
 * Aegis AI — Shadow AI Guard
 * Background service worker that monitors and blocks unauthorized AI tool usage.
 * Config is fetched per-tenant from the governance platform.
 */

const DEFAULT_CONFIG = {
  tenantId: null,
  apiKey: null, // Aegis API key with the 'shadow_ai:ingest' scope
  gatewayUrl: 'http://localhost:3000',
  platformUrl: 'http://localhost:5174',
  mode: 'monitor', // 'monitor' | 'block'
  syncIntervalMinutes: 5,
  blockedDomains: [
    'api.openai.com',
    'chat.openai.com',
    'chatgpt.com',
    'api.anthropic.com',
    'claude.ai',
    'bard.google.com',
    'gemini.google.com',
    'aistudio.google.com',
    'perplexity.ai',
    'api.cohere.ai',
    'api.mistral.ai',
    'chat.mistral.ai',
    'api.together.ai',
    'api.groq.com',
    'api-inference.huggingface.co',
    'api.replicate.com',
    'copilot.microsoft.com',
    'deepseek.com',
    'chat.deepseek.com',
  ],
  allowedDomains: [], // Tenant-specific exceptions
  blockPageMessage: 'This AI tool is not approved by your organization. Please use the approved AI gateway.',
};

let config = { ...DEFAULT_CONFIG };
let eventLog = [];
let managedKeys = [];

/**
 * Settings pushed by IT through Chrome policy (managed storage) win over anything set in the popup,
 * so employees can't switch monitoring off or point the extension at another tenant.
 */
async function loadConfig() {
  const stored = await chrome.storage.local.get(['config', 'eventLog']);
  let managed = {};
  try {
    managed = (await chrome.storage.managed.get(null)) || {};
  } catch {
    managed = {};
  }
  managedKeys = Object.keys(managed);
  config = { ...DEFAULT_CONFIG, ...(stored.config || {}), ...managed };
  if (stored.eventLog) eventLog = stored.eventLog;
}

// Service workers are restarted when idle, which resets globals; reload settings on every wake.
const configReady = loadConfig();

function authHeaders() {
  return config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {};
}

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await loadConfig();
  await applyRules();
  setupSyncAlarm();
  console.log('[Aegis] Shadow AI Guard installed', { mode: config.mode, tenant: config.tenantId });
});

chrome.runtime.onStartup.addListener(async () => {
  await loadConfig();
  await applyRules();
  setupSyncAlarm();
});

// ── Periodic config sync ──────────────────────────────────────────────────────

function setupSyncAlarm() {
  chrome.alarms.create('config-sync', { periodInMinutes: config.syncIntervalMinutes });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'config-sync') {
    await configReady;
    await syncConfig();
    await flushEvents();
  }
});

async function syncConfig() {
  if (!config.tenantId || !config.gatewayUrl || !config.apiKey) return;
  try {
    const resp = await fetch(`${config.gatewayUrl}/v1/shadow-ai/config/${encodeURIComponent(config.tenantId)}`, {
      headers: authHeaders(),
    });
    if (resp.ok) {
      const remote = await resp.json();
      config = { ...config, ...remote };
      await chrome.storage.local.set({ config });
      await applyRules();
      console.log('[Aegis] Config synced from server');
    }
  } catch (err) {
    console.warn('[Aegis] Config sync failed, using cached config', err.message);
  }
}

// ── Dynamic blocking rules ────────────────────────────────────────────────────

async function applyRules() {
  // Remove old dynamic rules
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeIds = existing.map((r) => r.id);
  if (removeIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
  }

  if (config.mode !== 'block') return; // Monitor mode — no blocking rules

  const effectiveDomains = config.blockedDomains.filter(
    (d) => !config.allowedDomains.includes(d)
  );

  const rules = effectiveDomains.map((domain, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: {
        url: `${config.platformUrl}/blocked?domain=${encodeURIComponent(domain)}&tenant=${config.tenantId || 'unknown'}`,
      },
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'other'],
    },
  }));

  if (rules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
  }

  console.log(`[Aegis] Applied ${rules.length} blocking rules (mode: ${config.mode})`);
}

// ── Event logging ─────────────────────────────────────────────────────────────

// Listen for web requests to monitored domains (works in both modes)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    configReady.then(() => recordRequest(details));
  },
  { urls: ['<all_urls>'] }
);

function recordRequest(details) {
  {
    const url = new URL(details.url);
    const domain = url.hostname;

    // Check if this domain is in our monitored list
    const isMonitored = config.blockedDomains.some(
      (d) => domain === d || domain.endsWith(`.${d}`)
    );
    if (!isMonitored) return;

    // Skip if it's an allowed domain for this tenant
    if (config.allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) return;

    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      domain,
      url: details.url,
      type: details.type,
      method: details.method || 'GET',
      blocked: config.mode === 'block',
      tenantId: config.tenantId,
    };

    eventLog.push(event);
    // Keep last 500 events
    if (eventLog.length > 500) eventLog = eventLog.slice(-500);
    chrome.storage.local.set({ eventLog });

    // Update badge
    chrome.action.setBadgeText({ text: String(eventLog.length) });
    chrome.action.setBadgeBackgroundColor({ color: config.mode === 'block' ? '#ef4444' : '#f59e0b' });

    console.log(`[Aegis] ${config.mode === 'block' ? 'BLOCKED' : 'DETECTED'}: ${domain} (${details.type})`);
  }
}

// ── Flush events to server ────────────────────────────────────────────────────

async function flushEvents() {
  if (!config.tenantId || !config.gatewayUrl || !config.apiKey || eventLog.length === 0) return;
  try {
    const resp = await fetch(`${config.gatewayUrl}/v1/shadow-ai/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      // The server accepts at most 500 events per call.
      body: JSON.stringify({ tenantId: config.tenantId, events: eventLog.slice(0, 500) }),
    });
    if (resp.ok) {
      eventLog = eventLog.slice(500);
      await chrome.storage.local.set({ eventLog });
      chrome.action.setBadgeText({ text: '' });
      console.log('[Aegis] Events flushed to server');
    }
  } catch (err) {
    console.warn('[Aegis] Event flush failed, will retry', err.message);
  }
}

// ── Message handler for popup ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_STATUS') {
    sendResponse({
      config: { ...config, apiKey: config.apiKey ? '********' : null },
      managedKeys,
      eventCount: eventLog.length,
      recentEvents: eventLog.slice(-10).reverse(),
    });
  } else if (msg.type === 'UPDATE_CONFIG') {
    // Ignore changes to anything IT manages through policy.
    const update = { ...msg.config };
    for (const k of managedKeys) delete update[k];
    config = { ...config, ...update };
    chrome.storage.local.set({ config });
    applyRules();
    sendResponse({ ok: true });
  } else if (msg.type === 'CLEAR_EVENTS') {
    eventLog = [];
    chrome.storage.local.set({ eventLog });
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
  } else if (msg.type === 'FLUSH_EVENTS') {
    flushEvents().then(() => sendResponse({ ok: true }));
    return true; // async response
  }
});
