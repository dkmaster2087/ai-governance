document.addEventListener('DOMContentLoaded', async () => {
  // Read directly from storage first (more reliable than messaging)
  const stored = await chrome.storage.local.get(['config', 'eventLog']);
  const config = stored.config || {};
  const eventLog = stored.eventLog || [];

  // Mode badge
  const badge = document.getElementById('modeBadge');
  const mode = config.mode || 'monitor';
  badge.textContent = mode === 'block' ? 'Blocking' : 'Monitoring';
  badge.className = `mode mode-${mode}`;

  // Stats
  document.getElementById('eventCount').textContent = eventLog.length;
  const blocked = eventLog.filter((e) => e.blocked).length;
  document.getElementById('blockedCount').textContent = blocked;
  const domains = new Set(eventLog.map((e) => e.domain));
  document.getElementById('domainCount').textContent = domains.size;

  // Config fields
  document.getElementById('tenantId').value = config.tenantId || '';
  document.getElementById('modeSelect').value = mode;
  document.getElementById('gatewayUrl').value = config.gatewayUrl || 'http://localhost:3000';

  // Dashboard link
  const platformUrl = config.platformUrl || 'http://localhost:5174';
  document.getElementById('dashLink').href = platformUrl + '/shadow-ai';
  document.getElementById('dashLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: platformUrl + '/shadow-ai' });
  });

  // Event list
  const recentEvents = eventLog.slice(-10).reverse();
  const list = document.getElementById('eventList');
  if (recentEvents.length === 0) {
    list.innerHTML = '<div class="empty">No activity detected yet</div>';
  } else {
    list.innerHTML = recentEvents.map((evt) => {
      const time = new Date(evt.timestamp);
      const ago = formatAgo(time);
      return `<div class="event">
        <span class="dot ${evt.blocked ? 'blocked' : 'detected'}"></span>
        <span class="domain">${evt.domain}</span>
        <span>${evt.type || ''}</span>
        <span class="time">${ago}</span>
      </div>`;
    }).join('');
  }

  // Save config
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const newConfig = {
      ...config,
      tenantId: document.getElementById('tenantId').value.trim(),
      mode: document.getElementById('modeSelect').value,
      gatewayUrl: document.getElementById('gatewayUrl').value.trim(),
    };
    await chrome.storage.local.set({ config: newConfig });
    // Also notify background worker
    chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', config: newConfig });
    document.getElementById('saveBtn').textContent = 'Saved!';
    setTimeout(() => { document.getElementById('saveBtn').textContent = 'Save & Apply'; }, 1500);
  });

  // Clear events
  document.getElementById('clearBtn').addEventListener('click', async () => {
    await chrome.storage.local.set({ eventLog: [] });
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' });
    document.getElementById('eventCount').textContent = '0';
    document.getElementById('blockedCount').textContent = '0';
    document.getElementById('domainCount').textContent = '0';
    document.getElementById('eventList').innerHTML = '<div class="empty">No activity detected yet</div>';
  });
});

function formatAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
