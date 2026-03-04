// ============================================================
// Murph AIO — Popup Script
// ============================================================

// Tab switching
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(`tab-${tab.dataset.tab}`);
    if (target) target.classList.add('active');

    // Load data when switching tabs
    if (tab.dataset.tab === 'history') loadOrderHistory();
    if (tab.dataset.tab === 'settings') loadSettings();
  });
});

// Toast helper
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'toast error visible' : 'toast visible';
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

// ============================================================
// HOME TAB
// ============================================================

async function loadHomeTab() {
  // WebSocket status
  try {
    const response = await chrome.runtime.sendMessage({ action: 'get-ws-status' });
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    const headerDot = document.getElementById('statusDot');

    if (response && response.connected) {
      dot.className = 'status-dot connected';
      text.className = 'status-text ok';
      text.textContent = 'Connected to Murph AIO app';
      headerDot.className = 'status-dot connected';
      headerDot.title = 'Connected to Electron app';
    } else {
      dot.className = 'status-dot disconnected';
      text.className = 'status-text warn';
      text.textContent = 'Not connected — open Murph AIO app';
      headerDot.className = 'status-dot disconnected';
      headerDot.title = 'Not connected to Electron app';
    }
  } catch (e) {
    console.error('[Popup] WS status check failed:', e);
  }

  // Discord username
  try {
    const { discordUsername } = await chrome.storage.local.get('discordUsername');
    const text = document.getElementById('discordUserText');
    if (discordUsername) {
      text.textContent = discordUsername;
      text.className = 'status-text ok';
    } else {
      text.textContent = 'No Discord name set';
      text.className = 'status-text warn';
    }
  } catch (e) {}

  // Today's checkouts
  try {
    const { veryOrderLog = [] } = await chrome.storage.local.get('veryOrderLog');
    const text = document.getElementById('todayCheckoutsText');
    const today = new Date().toDateString();
    const todayCount = veryOrderLog.filter(o => {
      const d = new Date(o.timestamp || o.createdAt);
      return d.toDateString() === today;
    }).length;
    text.innerHTML = `Total checkouts today &mdash; <span style="color:#f97316;font-weight:600;">${todayCount}</span>`;
  } catch (e) {}
}

// ============================================================
// HISTORY TAB
// ============================================================

async function loadOrderHistory() {
  const container = document.getElementById('orderList');

  try {
    const { veryOrderLog = [] } = await chrome.storage.local.get('veryOrderLog');

    if (veryOrderLog.length === 0) {
      container.innerHTML = '<div class="empty-state">No orders tracked yet.</div>';
      return;
    }

    // Show newest first
    const sorted = [...veryOrderLog].reverse();
    container.innerHTML = sorted.map(order => {
      const statusClass = order.webhookStatus === 'sent' ? '' :
                          order.webhookStatus === 'failed' ? 'failed' : 'pending';
      const itemNames = (order.items || []).map(i => i.name || 'Unknown').join(', ');
      const date = new Date(order.timestamp || order.createdAt);
      const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="order-item ${statusClass}">
          <div class="order-ref">${order.orderRef || 'Unknown'}</div>
          <div class="order-meta">${dateStr} ${timeStr} &middot; ${order.webhookStatus || 'unknown'}</div>
          ${itemNames ? `<div class="order-items">${itemNames.substring(0, 80)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Error loading history.</div>';
  }
}

document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
  if (confirm('Clear all order history?')) {
    await chrome.storage.local.remove('veryOrderLog');
    loadOrderHistory();
    showToast('History cleared');
  }
});

// ============================================================
// SETTINGS TAB
// ============================================================

async function loadSettings() {
  try {
    const { discordUsername } = await chrome.storage.local.get('discordUsername');
    document.getElementById('settingsDiscordName').value = discordUsername || '';
  } catch (e) {}

  document.getElementById('extIdDisplay').textContent = chrome.runtime.id || 'Unknown';
}

document.getElementById('saveDiscordBtn').addEventListener('click', async () => {
  const name = document.getElementById('settingsDiscordName').value.trim();
  if (!name) {
    showToast('Enter a Discord username', true);
    return;
  }
  await chrome.storage.local.set({ discordUsername: name });
  const indicator = document.getElementById('discordSaved');
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 2000);
  showToast('Discord name saved');
  // Update home tab
  loadHomeTab();
});

// ============================================================
// INIT
// ============================================================

loadHomeTab();
loadSettings();
