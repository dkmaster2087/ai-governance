document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (!status) return;
    const { config, eventCount, recentEvents } = status;

    // Mode badge
    const badge = document.getElementById('modeBadge');
    badge.textContent = config.mode === 'block' ? 'Blocking' : 'Monitoring';
    badge.className = `mode mode-${config.mode}`;

    // Stats
    document.getElementById('eventCount').textContent = eventCount;
    const blocked = recentEvents.filter((e) => e.blocked).length;
    document.getElementById('blockedCount').textContent = blocked;
    const domains = new Set(recentEvents.map((e) => e.domain));
    document.getElementById('domainCount').textContent = domains.size;

    // Config fields
    document.getElementById('tenantId').value = config.tenantId || '';
    document.getElementById('modeSelect').value = config.mode;
    document.getElementById('gatewayUrl').value = config.gatewayUrl || '';

    // Dashboard link
    document.getElementById('dashLink').href = config.platformUrl + '/shadow-ai';
    document.getElementById('dashLink').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: config.platformUrl + '/shadow-ai' });
    });

    // Event list
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
  });

  // Save config
  document.getElementById('saveBtn').addEventListener('click', () => {
    const tenantId = document.getElementById('tenantId').value.trim();
    const mode = document.getElementById('modeSelect').value;
    const gatewayUrl = document.getElementById('gatewayUrl').value.trim();

    chrome.runtime.sendMessage({
      type: 'UPDATE_CONFIG',
      config: { tenantId, mode, gatewayUrl },
    }, () => {
      document.getElementById('saveBtn').textContent = 'Saved!';
      setTimeout(() => {
        document.getElementById('saveBtn').textContent = 'Save & Apply';
      }, 1500);
    });
  });

  // Clear events
  document.getElementById('clearBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, () => {
      document.getElementById('eventCount').textContent = '0';
      document.getElementById('blockedCount').textContent = '0';
      document.getElementById('domainCount').textContent = '0';
      document.getElementById('eventList').innerHTML = '<div class="empty">No activity detected yet</div>';
    });
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
