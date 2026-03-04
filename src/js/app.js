// ============================================================
// MURPH AIO — SPA Router + Page Logic (v1.3 — Modular Restructure)
// ============================================================

// Global error handlers to prevent UI errors from killing async task flow
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandledrejection]', e.reason?.message || e.reason, e.reason?.stack);
  e.preventDefault();
});
window.addEventListener('error', (e) => {
  console.error('[error]', e.message, e.filename, e.lineno);
});

const API = window.murphAPI;

// ============================================================
// MODULE CONFIG (central registry for all site modules)
// ============================================================
const MODULE_CONFIG = {
  freemans: {
    name: 'Freemans',
    subtitle: 'Freemans — Bulk Add',
    urlPattern: 'freemans.com',
    placeholder: 'https://www.freemans.com/products/...',
    defaultQty: 20,
    enabled: true,
    mode: 'electron'
  },
  very: {
    name: 'Very',
    subtitle: 'Very — Auto Checkout',
    urlPattern: 'very.co.uk',
    placeholder: 'Paste Stellar cart link...',
    defaultQty: 1,
    enabled: true,
    mode: 'extension',
    icon: ''
  },
  jdwilliams: {
    name: 'JD Williams',
    subtitle: 'JD Williams — Coming Soon',
    urlPattern: 'jdwilliams.co.uk',
    placeholder: 'https://www.jdwilliams.co.uk/...',
    defaultQty: 20,
    enabled: false,
    mode: 'electron'
  }
};

let currentModule = 'freemans';

// ============================================================
// SESSION STATS (in-memory, reset each launch)
// ============================================================
let sessionTasksRun = 0;
let sessionErrors = 0;
const sessionStart = Date.now();

// ============================================================
// PERSISTENT ERROR LOG — helpers
// ============================================================
let currentErrorFilter = 'all';

async function logError(message, details = {}) {
  const entry = {
    message,
    level: details.level || 'error',
    module: details.module || 'system',
    taskId: details.taskId || null,
    productCode: details.productCode || null,
    step: details.step || null,
    stack: details.stack || null
  };
  try { await API.logError(entry); } catch (e) { /* never crash */ }
  sessionErrors++;
  updateErrorBadge();
}

function updateErrorBadge() {
  const badge = document.getElementById('errorCountBadge');
  if (!badge) return;
  if (sessionErrors > 0) {
    badge.textContent = sessionErrors > 99 ? '99+' : sessionErrors;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

async function renderErrorLog() {
  const scroll = document.getElementById('errorLogScroll');
  if (!scroll) return;

  const log = await API.getErrorLog();
  const filtered = currentErrorFilter === 'all'
    ? log
    : log.filter(e => e.level === currentErrorFilter);

  if (filtered.length === 0) {
    scroll.innerHTML = `<div class="empty-state" id="errorLogEmpty"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div><div class="empty-state-text">${currentErrorFilter === 'all' ? 'No errors logged.' : 'No ' + currentErrorFilter + ' entries.'}</div></div>`;
    return;
  }

  scroll.innerHTML = filtered.map(e => {
    const d = new Date(e.timestamp);
    const time = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
    const date = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
    const levelIcons = { error: '!', warning: '!', debug: 'i' };
    const hasDetail = e.taskId || e.productCode || e.step || e.stack;
    const detailRows = [
      e.taskId ? `<div class="error-detail-row"><span class="error-detail-label">Task ID</span><span class="error-detail-value">${escapeHtml(e.taskId)}</span></div>` : '',
      e.productCode ? `<div class="error-detail-row"><span class="error-detail-label">Product</span><span class="error-detail-value">${escapeHtml(e.productCode)}</span></div>` : '',
      e.step ? `<div class="error-detail-row"><span class="error-detail-label">Step</span><span class="error-detail-value">${escapeHtml(e.step)}</span></div>` : '',
      e.stack ? `<div class="error-detail-row"><span class="error-detail-label">Stack</span><span class="error-detail-value">${escapeHtml(e.stack)}</span></div>` : ''
    ].filter(Boolean).join('');
    return `<div class="error-log-entry" data-id="${e.id}">
      <span class="error-level-badge ${e.level}">${levelIcons[e.level] || '!'}</span>
      <span class="error-log-time">${date} ${time}</span>
      <div class="error-log-content">
        <div class="error-log-msg">${escapeHtml(e.message)}<span class="error-log-module">${escapeHtml(e.module || 'system')}</span></div>
        ${hasDetail ? `<div class="error-detail-expand">${detailRows}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  // Click to expand details
  scroll.querySelectorAll('.error-log-entry').forEach(entry => {
    entry.addEventListener('click', () => entry.classList.toggle('expanded'));
  });
}

// ============================================================
// APP CUSTOMISATION — Avatars, Accent Colours
// ============================================================
const AVATAR_OPTIONS = {
  default: '🟢', ghost: '👻', robot: '🤖', fire: '🔥', skull: '💀',
  rocket: '🚀', alien: '👽', ninja: '🥷', crown: '👑', diamond: '💎',
  gorilla: '🦍', clown: '🤡'
};

const ACCENT_COLOURS = {
  green:  { primary: '#00b894', light: '#00cec9' },
  blue:   { primary: '#0984e3', light: '#74b9ff' },
  purple: { primary: '#6c5ce7', light: '#a29bfe' },
  orange: { primary: '#F97316', light: '#FB923C' },
  red:    { primary: '#d63031', light: '#ff7675' },
  pink:   { primary: '#e84393', light: '#fd79a8' },
  cyan:   { primary: '#00cec9', light: '#81ecec' }
};

function applyCustomisation(settings) {
  // Accent colour
  const colour = ACCENT_COLOURS[settings.accentColour] || ACCENT_COLOURS.green;
  const root = document.documentElement;
  root.style.setProperty('--primary', colour.primary);
  root.style.setProperty('--primary-light', colour.light);
  root.style.setProperty('--primary-dim', hexToRgba(colour.primary, 0.12));
  root.style.setProperty('--primary-glow', hexToRgba(colour.primary, 0.25));
  root.style.setProperty('--success', colour.primary);

  // Avatar
  const logo = document.querySelector('.sidebar-logo');
  if (logo) {
    if (settings.avatar && settings.avatar !== 'default') {
      const emoji = AVATAR_OPTIONS[settings.avatar] || AVATAR_OPTIONS.default;
      logo.classList.add('emoji');
      logo.textContent = emoji;
      logo.style.backgroundImage = 'none';
    } else {
      logo.classList.remove('emoji');
      logo.textContent = '';
      logo.style.backgroundImage = 'url("https://cdn.discordapp.com/icons/1464279501277102142/c5956eedc47c1b0ae164cea6e9696ac7.webp?size=128")';
      logo.style.backgroundSize = 'cover';
      logo.style.backgroundPosition = 'center';
    }
  }

  // Greeting
  updateGreeting(settings.username);
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function updateGreeting(username) {
  const greetEl = document.getElementById('greeting');
  if (!greetEl) return;
  const hour = new Date().getHours();
  let timeGreeting;
  if (hour < 12) { timeGreeting = 'Good morning'; }
  else if (hour < 18) { timeGreeting = 'Good afternoon'; }
  else { timeGreeting = 'Good evening'; }
  greetEl.textContent = username ? `${timeGreeting}, ${username}` : timeGreeting;
}

function renderAvatarPicker(current) {
  const picker = document.getElementById('avatarPicker');
  if (!picker) return;
  picker.innerHTML = Object.entries(AVATAR_OPTIONS).map(([key, emoji]) =>
    `<button class="avatar-option ${key === current ? 'active' : ''}" data-avatar="${key}">${emoji}</button>`
  ).join('');
  picker.querySelectorAll('.avatar-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      picker.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const settings = await API.getSettings();
      settings.avatar = btn.dataset.avatar;
      await API.saveSettings(settings);
      applyCustomisation(settings);
    });
  });
}

function renderColourPicker(current) {
  const picker = document.getElementById('colourPicker');
  if (!picker) return;
  picker.innerHTML = Object.entries(ACCENT_COLOURS).map(([key, col]) =>
    `<button class="colour-dot ${key === current ? 'active' : ''}" data-colour="${key}" style="background:${col.primary};" title="${key}"></button>`
  ).join('');
  picker.querySelectorAll('.colour-dot').forEach(btn => {
    btn.addEventListener('click', async () => {
      picker.querySelectorAll('.colour-dot').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const settings = await API.getSettings();
      settings.accentColour = btn.dataset.colour;
      await API.saveSettings(settings);
      applyCustomisation(settings);
    });
  });
}

// ============================================================
// TOAST NOTIFICATION SYSTEM + TOAST HISTORY (v1.9.1)
// ============================================================
const toastContainer = document.getElementById('toastContainer');
const toastHistory = [];
const MAX_TOAST_HISTORY = 50;

function toast(message, type = 'info', duration = 3500) {
  const toastSvgs = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `
    <span class="toast-icon ${type}">${toastSvgs[type] || toastSvgs.info}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
  `;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 250);
  }, duration);

  // Push to toast history
  toastHistory.unshift({ message, type, timestamp: Date.now() });
  if (toastHistory.length > MAX_TOAST_HISTORY) toastHistory.pop();
  updateBellBadge();
}

function updateBellBadge() {
  const badge = document.getElementById('bellBadge');
  if (!badge) return;
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentCount = toastHistory.filter(t => t.timestamp > fiveMinAgo).length;
  if (recentCount > 0) {
    badge.textContent = recentCount > 99 ? '99+' : recentCount;
    badge.classList.add('visible');
  } else {
    badge.classList.remove('visible');
  }
}

function renderToastHistory() {
  const list = document.getElementById('toastHistoryList');
  if (!list) return;
  if (toastHistory.length === 0) {
    list.innerHTML = '<div class="toast-history-empty">No notifications yet.</div>';
    return;
  }
  const histSvgs = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };
  list.innerHTML = toastHistory.map(t => {
    const d = new Date(t.timestamp);
    const time = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    return `<div class="toast-history-item">
      <span class="toast-history-icon ${t.type}">${histSvgs[t.type] || histSvgs.info}</span>
      <span class="toast-history-time">${time}</span>
      <span class="toast-history-msg">${escapeHtml(t.message)}</span>
    </div>`;
  }).join('');
}

// Bell click handler
document.getElementById('bellBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('toastHistoryDropdown');
  dropdown.classList.toggle('open');
  if (dropdown.classList.contains('open')) renderToastHistory();
});

// Clear toast history
document.getElementById('clearToastHistory')?.addEventListener('click', () => {
  toastHistory.length = 0;
  updateBellBadge();
  renderToastHistory();
});

// Close dropdown on click outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('toastHistoryDropdown');
  const bellWrap = e.target.closest('.topbar-bell-wrap');
  if (!bellWrap && dropdown) dropdown.classList.remove('open');
});

// Periodically update badge (for expiry of 5-min window)
setInterval(updateBellBadge, 30000);

// ============================================================
// CONFIRM DIALOG
// ============================================================
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmMsg = document.getElementById('confirmMsg');
const confirmYes = document.getElementById('confirmYes');
const confirmNo = document.getElementById('confirmNo');
let confirmResolve = null;

function showConfirm(message, dangerLabel = 'Confirm') {
  return new Promise(resolve => {
    confirmMsg.textContent = message;
    confirmYes.textContent = dangerLabel;
    confirmOverlay.classList.add('active');
    confirmResolve = resolve;
  });
}
confirmYes.addEventListener('click', () => { confirmOverlay.classList.remove('active'); if (confirmResolve) confirmResolve(true); confirmResolve = null; });
confirmNo.addEventListener('click', () => { confirmOverlay.classList.remove('active'); if (confirmResolve) confirmResolve(false); confirmResolve = null; });
// Mousedown-inside fix: only close if mousedown AND mouseup both on overlay
confirmOverlay.addEventListener('mousedown', (e) => { confirmOverlay._mouseDownOnOverlay = (e.target === confirmOverlay); });
confirmOverlay.addEventListener('mouseup', (e) => {
  if (e.target === confirmOverlay && confirmOverlay._mouseDownOnOverlay) {
    confirmOverlay.classList.remove('active');
    if (confirmResolve) confirmResolve(false);
    confirmResolve = null;
  }
  confirmOverlay._mouseDownOnOverlay = false;
});

// ============================================================
// NAVIGATION
// ============================================================
const pages = document.querySelectorAll('.page');
const navBtns = document.querySelectorAll('.nav-btn[data-nav]');
const topbarTitle = document.getElementById('topbarTitle');

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  tasks: 'Tasks',
  setup: 'Profiles & Proxies',
  extension: 'Extension',
  settings: 'Settings'
};

function navigateTo(page) {
  pages.forEach(p => p.classList.remove('active'));
  navBtns.forEach(b => b.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) { void target.offsetWidth; target.classList.add('active'); }
  navBtns.forEach(b => { if (b.dataset.nav === page) b.classList.add('active'); });
  topbarTitle.textContent = PAGE_TITLES[page] || page;

  // Update sidebar indicator
  const activeBtn = document.querySelector(`.nav-btn[data-nav="${page}"]`);
  if (activeBtn) updateSidebarIndicator(activeBtn);

  // Hide bulk bar when leaving tasks
  if (page !== 'tasks') {
    const bulkBar = document.getElementById('bulkActionsBar');
    if (bulkBar) bulkBar.classList.remove('visible');
  }

  if (page === 'dashboard') loadDashboard();
  if (page === 'tasks') { loadTasks(); }
  if (page === 'setup') { loadProfiles(); renderProxyGroups(); }
  if (page === 'extension') { loadExtensionPage(); }
  if (page === 'settings') { loadSettings(); renderErrorLog(); }
}

// Sidebar indicator animation (v1.9.1)
function updateSidebarIndicator(targetBtn) {
  const indicator = document.getElementById('sidebarIndicator');
  const nav = document.querySelector('.sidebar-nav');
  if (!indicator || !nav || !targetBtn) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = targetBtn.getBoundingClientRect();
  const topOffset = btnRect.top - navRect.top + (btnRect.height / 2) - 10;
  indicator.style.top = topOffset + 'px';
}

// Skeleton loading screens (v1.9.1)
function showSkeletons(containerId, type, count) {
  const container = document.getElementById(containerId);
  if (!container) return;
  // Don't show skeletons if container already has real cards or existing skeletons
  if (container.querySelector('.skeleton') || container.querySelector('.task-card, .profile-card, .dash-task-item, .checkout-log-item')) return;
  const cls = type === 'task' ? 'skeleton-task' : type === 'profile' ? 'skeleton-profile' : 'skeleton-dashboard';
  let html = '';
  for (let i = 0; i < count; i++) html += `<div class="skeleton ${cls}"></div>`;
  container.innerHTML = html;
}

navBtns.forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.nav)));
document.querySelector('.sidebar-logo').addEventListener('click', () => navigateTo('dashboard'));

// Error log filter buttons
document.querySelectorAll('.error-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentErrorFilter = btn.dataset.errorFilter;
    document.querySelectorAll('.error-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderErrorLog();
  });
});

// Clear error log button
document.getElementById('clearErrorLogBtn').addEventListener('click', async () => {
  const yes = await showConfirm('Clear the entire error log? This cannot be undone.', 'Clear');
  if (yes) { await API.clearErrorLog(); renderErrorLog(); toast('Error log cleared', 'info'); }
});

// Export error log button
document.getElementById('exportErrorLogBtn').addEventListener('click', async () => {
  const log = await API.getErrorLog();
  if (log.length === 0) { toast('No errors to export', 'info'); return; }
  const text = log.map(e => {
    const d = new Date(e.timestamp);
    const ts = d.toISOString();
    let line = `[${ts}] [${e.level.toUpperCase()}] [${e.module}] ${e.message}`;
    if (e.taskId) line += `\n  Task: ${e.taskId}`;
    if (e.productCode) line += `\n  Product: ${e.productCode}`;
    if (e.step) line += `\n  Step: ${e.step}`;
    if (e.stack) line += `\n  Stack: ${e.stack}`;
    return line;
  }).join('\n\n');
  try {
    await navigator.clipboard.writeText(text);
    toast(`Copied ${log.length} error entries to clipboard`, 'success');
  } catch (e) {
    toast('Failed to copy to clipboard', 'error');
  }
});

// ============================================================
// DASHBOARD ACTIONS
// ============================================================
document.getElementById('dashViewAllTasks').addEventListener('click', () => navigateTo('tasks'));
// Clear checkout log button removed in v2.0

// ============================================================
// CLOCK + GREETING
// ============================================================
function updateClock() {
  const now = new Date();
  document.getElementById('clock').textContent =
    String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
}
updateClock();
setInterval(updateClock, 15000);

function setGreeting() {
  // Use updateGreeting with stored username
  API.getSettings().then(s => updateGreeting(s.username || ''));
}
setGreeting();

// ============================================================
// INIT
// ============================================================
async function init() {
  const { key } = await API.checkKey();
  document.getElementById('topbarKey').textContent = key || '';

  // Apply customisation on startup
  const settings = await API.getSettings();
  applyCustomisation(settings);

  // Set initial sidebar indicator position
  const activeNav = document.querySelector('.nav-btn.active');
  if (activeNav) setTimeout(() => updateSidebarIndicator(activeNav), 50);

  loadDashboard();
  updateErrorBadge();

  // Listen for checkout progress events from main process
  API.onCheckoutProgress((data) => {
    const { taskId, step, stepLabel, progress } = data;
    const existing = runningTasks.get(taskId);
    if (existing) {
      existing.progress = progress;
      existing.step = step;
      existing.stepLabel = stepLabel;
    }

    // Try direct DOM update first (fast, no flicker)
    const bar = document.getElementById(`progress-${taskId}`);
    if (bar) {
      bar.style.width = progress + '%';
      const taskCard = bar.closest('.task-card');
      if (taskCard) {
        const detail = taskCard.querySelector('.task-detail');
        if (detail) detail.textContent = stepLabel;
        const steps = taskCard.querySelector('.task-checkout-steps');
        if (steps) {
          steps.querySelectorAll('.step').forEach((el, idx) => {
            const s = idx + 1;
            el.classList.remove('active', 'current');
            if (s < step) el.classList.add('active');
            else if (s === step) el.classList.add('current');
          });
        }
      }
    } else {
      // DOM elements don't exist (user on different page) — refresh tasks page
      try { loadTasks(); } catch (e) {}
    }
    // Always keep dashboard in sync
    try { loadDashboard(); } catch (e) {}
  });
}

// ============================================================
// DASHBOARD
// ============================================================
async function loadDashboard() {
  showSkeletons('dashActiveTasks', 'dashboard', 2);
  const stats = await API.getStats();
  const tasks = await API.getTasks();

  // Stat cards
  animateValue('statTasksRun', stats.tasksRun || 0);
  animateValue('statItems', stats.itemsAdded || 0);
  animateValue('statCheckouts', stats.checkouts || 0);
  // Success rate
  const total = stats.tasksRun || 0;
  const checkouts = stats.checkouts || 0;
  const rateEl = document.getElementById('statSuccessRate');
  if (rateEl) {
    rateEl.textContent = total > 0 ? Math.round((checkouts / total) * 100) + '%' : '—';
  }

  // Active tasks panel
  const activeTasks = tasks.filter(t => t.status === 'running');
  const recentIdle = tasks.filter(t => t.status === 'idle').slice(0, 3);
  const displayTasks = [...activeTasks, ...recentIdle].slice(0, 5);
  const atContainer = document.getElementById('dashActiveTasks');

  if (displayTasks.length === 0) {
    atContainer.innerHTML = '<div class="empty-state-mini">No tasks running.</div>';
  } else {
    atContainer.innerHTML = displayTasks.map(t => {
      const modName = (MODULE_CONFIG[t.module || 'freemans'] || {}).name || 'Task';
      return `<div class="dash-task-item">
        <span class="task-status-indicator ${t.status || 'idle'}"></span>
        <span style="flex:1;color:var(--text);font-size:12px;">${escapeHtml(t.productCode || modName)} — Qty ${t.quantity}</span>
        <span style="color:var(--text-muted);font-size:11px;text-transform:capitalize;">${t.status}</span>
      </div>`;
    }).join('');
  }

  // Checkout log panel
  const checkoutContainer = document.getElementById('dashCheckoutLog');
  if (checkoutContainer) {
    try {
      const checkoutLog = await API.getCheckoutLog();
      if (checkoutLog.length === 0) {
        checkoutContainer.innerHTML = '<div class="empty-state-mini">No checkout attempts yet.</div>';
      } else {
        checkoutContainer.innerHTML = checkoutLog.slice(0, 10).map(c => {
          const d = new Date(c.timestamp);
          const time = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
          const date = String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
          const isSuccess = c.status === 'success';
          const statusClass = isSuccess ? 'success' : 'failed';
          const statusIcon = isSuccess ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
          const detail = isSuccess
            ? (c.orderNumber ? 'Order #' + escapeHtml(c.orderNumber) : 'Checked out')
            : escapeHtml(c.error || 'Failed');
          const dur = c.durationSeconds ? c.durationSeconds + 's' : '';
          const qty = c.quantity ? `× ${c.quantity}` : '';
          const profileName = c.profileName ? escapeHtml(c.profileName) : '';
          return `<div class="checkout-log-item ${statusClass}">
            <span class="checkout-log-status ${statusClass}">${statusIcon}</span>
            <div class="checkout-log-info">
              <div class="checkout-log-top">
                <span class="checkout-log-product">${escapeHtml(c.productCode || c.module || 'Task')} ${qty}</span>
                <span class="checkout-log-time">${date} ${time}</span>
              </div>
              <div class="checkout-log-bottom">
                <span class="checkout-log-detail">${detail}</span>
                ${profileName ? `<span class="checkout-log-profile">${profileName}</span>` : ''}
                ${dur ? `<span class="checkout-log-duration">${dur}</span>` : ''}
              </div>
            </div>
          </div>`;
        }).join('');
      }
    } catch (e) {
      checkoutContainer.innerHTML = '<div class="empty-state-mini">No checkout attempts yet.</div>';
    }
  }

  // Checkout chart
  try { await renderCheckoutChart(); } catch (e) { /* chart failure shouldn't break dashboard */ }

  // Session stats
  const uptimeMs = Date.now() - sessionStart;
  const uptimeMins = Math.floor(uptimeMs / 60000);
  const uptimeStr = uptimeMins >= 60 ? Math.floor(uptimeMins/60) + 'h ' + (uptimeMins%60) + 'm' : uptimeMins + 'm';
  const sessionTasksEl = document.getElementById('sessionTasksRun');
  const sessionUptimeEl = document.getElementById('sessionUptime');
  const sessionErrorsEl = document.getElementById('sessionErrors');
  if (sessionTasksEl) sessionTasksEl.textContent = sessionTasksRun;
  if (sessionUptimeEl) sessionUptimeEl.textContent = uptimeStr;
  if (sessionErrorsEl) sessionErrorsEl.textContent = sessionErrors;
}

// ============================================================
// CHECKOUT CHART (Chart.js — v2.0)
// ============================================================
let checkoutChartInstance = null;

async function renderCheckoutChart() {
  const canvas = document.getElementById('checkoutChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const checkoutLog = await API.getCheckoutLog();

  // Aggregate by day for last 7 days
  const days = [];
  const successCounts = [];
  const failedCounts = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().slice(0, 10);
    const dayLabel = date.toLocaleDateString('en-GB', { weekday: 'short' });

    const dayEntries = checkoutLog.filter(c => {
      const entryDate = new Date(c.timestamp).toISOString().slice(0, 10);
      return entryDate === dateStr;
    });

    days.push(dayLabel);
    successCounts.push(dayEntries.filter(c => c.status === 'success').length);
    failedCounts.push(dayEntries.filter(c => c.status !== 'success').length);
  }

  // Destroy existing chart before creating new one
  if (checkoutChartInstance) {
    checkoutChartInstance.destroy();
    checkoutChartInstance = null;
  }

  const ctx = canvas.getContext('2d');
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#F97316';

  checkoutChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days,
      datasets: [
        {
          label: 'Success',
          data: successCounts,
          backgroundColor: accentColor + 'CC',
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.6,
          categoryPercentage: 0.7
        },
        {
          label: 'Failed',
          data: failedCounts,
          backgroundColor: '#e74c3c99',
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.6,
          categoryPercentage: 0.7
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: 'rgba(255,255,255,0.5)',
            font: { size: 11 },
            boxWidth: 12,
            boxHeight: 12,
            borderRadius: 3,
            useBorderRadius: true,
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0,0,0,0.85)',
          titleColor: '#fff',
          bodyColor: 'rgba(255,255,255,0.8)',
          padding: 10,
          cornerRadius: 6,
          titleFont: { size: 12, weight: '600' },
          bodyFont: { size: 11 }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: 'rgba(255,255,255,0.4)',
            font: { size: 11 }
          },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255,255,255,0.05)',
            drawBorder: false
          },
          ticks: {
            color: 'rgba(255,255,255,0.4)',
            font: { size: 11 },
            stepSize: 1,
            padding: 8
          },
          border: { display: false }
        }
      }
    }
  });
}

function animateValue(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) { el.textContent = target; return; }
  const duration = 400, start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(current + (target - current) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ============================================================
// MODULE TABS
// ============================================================
document.querySelectorAll('.module-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.classList.contains('disabled')) return;
    currentModule = tab.dataset.module;
    document.querySelectorAll('.module-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const cfg = MODULE_CONFIG[currentModule];
    document.getElementById('taskModuleSubtitle').textContent = cfg ? cfg.subtitle : '';
    updateVeryUI();
    // Only load Freemans task list when on Freemans module
    if (currentModule !== 'very') loadTasks();
  });
});

// Very-specific UI toggling — switches between Freemans list view and Very workspace
function updateVeryUI() {
  const isVery = currentModule === 'very';

  // Toggle Freemans task list vs Very workspace
  const taskToolbar = document.getElementById('taskToolbar');
  const tasksScroll = document.getElementById('tasksScroll');
  const veryWorkspace = document.getElementById('veryWorkspace');

  if (taskToolbar) taskToolbar.style.display = isVery ? 'none' : 'flex';
  if (tasksScroll) tasksScroll.style.display = isVery ? 'none' : 'block';
  if (veryWorkspace) veryWorkspace.style.display = isVery ? 'flex' : 'none';

  // When switching to Very, load groups/links and profiles
  if (isVery) {
    initVeryLinkGroups();
    loadVeryProfiles();
    renderVeryTaskList();
  }

  // Modal-related toggles for the Freemans modal (still used for Freemans)
  const veryFields = document.getElementById('panelVeryFields');
  const deliverySelect = document.getElementById('panelDelivery');
  const qtyGroup = document.getElementById('panelQty')?.closest('.form-group');

  if (veryFields) veryFields.style.display = 'none'; // Very no longer uses the modal
  if (qtyGroup) qtyGroup.style.display = isVery ? 'none' : 'block';

  if (deliverySelect && !isVery) {
    deliverySelect.innerHTML = `
      <option value="standard">Standard Delivery</option>
      <option value="nextday">Next Day Delivery</option>
      <option value="express">Express Delivery</option>
      <option value="named">Named Day Delivery</option>
    `;
  }
}

// Delivery method change — show C&C fields
document.getElementById('panelDelivery')?.addEventListener('change', () => {
  const ccFields = document.getElementById('panelCCFields');
  if (ccFields && currentModule === 'very') {
    ccFields.style.display = document.getElementById('panelDelivery').value === 'click-and-collect' ? 'block' : 'none';
  }
});

// Extension status listener
API.onExtensionStatus?.((data) => {
  const dot = document.getElementById('extDot');
  const label = document.getElementById('extLabel');
  if (dot) {
    dot.className = 'ext-dot ' + (data.connected ? 'connected' : 'disconnected');
  }
  if (label) {
    label.textContent = data.connected ? 'Ext' : 'Ext';
    label.title = data.connected ? 'Chrome Extension Connected' : 'Chrome Extension Disconnected';
  }
});

// Check extension status on load
API.getExtensionStatus?.().then((data) => {
  const dot = document.getElementById('extDot');
  if (dot) dot.className = 'ext-dot ' + (data.connected ? 'connected' : 'disconnected');
});

// ============================================================
// TASKS
// ============================================================
const runningTasks = new Map();
const taskQueue = [];
let queuePaused = false;
let panelMode = 'create';
let editingTaskId = null;
let editingMonitorId = null;
let selectedProfiles = []; // multi-select profile IDs

// ============================================================
// TASK MODAL — Open, Close, Toggle Type (v2.0)
// ============================================================
let currentTaskType = 'checkout'; // 'checkout' | 'monitor'

function toggleModalTaskType(type) {
  currentTaskType = type;
  const isMonitor = type === 'monitor';
  document.getElementById('panelCheckoutFields').style.display = isMonitor ? 'none' : 'block';
  document.getElementById('panelMonitorFields').style.display = isMonitor ? 'block' : 'none';
  document.getElementById('panelScheduleGroup').style.display = isMonitor ? 'none' : 'block';

  // Update toggle buttons
  document.querySelectorAll('.type-toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });

  if (panelMode === 'create') {
    document.getElementById('taskModalSaveBtn').textContent = isMonitor ? 'Create Monitor' : 'Create Task';
  }
}

async function openTaskModal(mode = 'create', item = null) {
  panelMode = mode;
  editingTaskId = null;
  editingMonitorId = null;
  selectedProfiles = [];

  const cfg = MODULE_CONFIG[currentModule];
  const overlay = document.getElementById('taskModalOverlay');
  if (!overlay) return;

  // Reset to checkout type
  toggleModalTaskType('checkout');

  // Reset all fields
  document.getElementById('panelUrl').value = '';
  document.getElementById('panelUrl').placeholder = cfg.placeholder;
  const settings = await API.getSettings();
  document.getElementById('panelQty').value = settings.defaultQuantity || cfg.defaultQty;
  document.getElementById('panelDelivery').value = 'standard';
  document.getElementById('panelMonitorName').value = '';
  document.getElementById('panelMonitorInterval').value = '30000';
  document.getElementById('panelMonitorAutoRun').checked = false;
  document.getElementById('panelMonitorAutoRunFields').style.display = 'none';
  document.getElementById('panelMonitorQty').value = '20';

  // Reset schedule
  document.getElementById('panelScheduleType').value = '';
  document.getElementById('panelScheduleTime').style.display = 'none';
  document.getElementById('panelScheduleTime').value = '';
  document.getElementById('panelScheduleDate').style.display = 'none';
  document.getElementById('panelScheduleDate').value = '';
  document.getElementById('panelScheduleDays').style.display = 'none';
  document.querySelectorAll('#panelScheduleDays input').forEach(cb => cb.checked = false);

  // Populate profiles multi-select
  const profiles = await API.getProfiles();
  const pmsOptions = document.getElementById('pmsOptions');
  pmsOptions.innerHTML = profiles.map(p => {
    const tag = p.existingAccount ? ' (Login)' : ' (Guest)';
    const cardHint = p.cardNumber ? ` · •••• ${p.cardNumber.slice(-4)}` : '';
    return `<label class="pms-option"><input type="checkbox" value="${p.id}"><span>${escapeHtml(p.name)}${tag}${cardHint}</span></label>`;
  }).join('');

  // Also populate monitor auto-run profile dropdown
  const profOptions = '<option value="">None</option>' + profiles.map(p => {
    const tag = p.existingAccount ? ' (Login)' : ' (Guest)';
    return `<option value="${p.id}">${escapeHtml(p.name)}${tag}</option>`;
  }).join('');
  document.getElementById('panelMonitorProfile').innerHTML = profOptions;

  // Populate proxy groups
  const proxyGroups = await API.getProxyGroups();
  const proxySel = document.getElementById('panelProxyGroup');
  proxySel.innerHTML = '<option value="">None (Direct)</option>' +
    proxyGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${(g.proxies||[]).length})</option>`).join('');

  // Modal title + button
  document.getElementById('taskModalTitle').textContent = 'Create Task';
  document.getElementById('taskModalSaveBtn').textContent = 'Create Task';

  // If editing, populate fields
  if (mode === 'edit' && item) {
    const isMonitor = !!item.productUrl && !item.url;

    if (isMonitor) {
      editingMonitorId = item.id;
      toggleModalTaskType('monitor');
      document.getElementById('panelUrl').value = item.productUrl || '';
      document.getElementById('panelMonitorName').value = item.productName || '';
      document.getElementById('panelMonitorInterval').value = String(item.checkInterval || 30000);
      document.getElementById('panelMonitorAutoRun').checked = !!item.autoRun;
      document.getElementById('panelMonitorAutoRunFields').style.display = item.autoRun ? 'block' : 'none';
      document.getElementById('panelMonitorQty').value = item.quantity || 20;
      document.getElementById('panelMonitorProfile').value = item.profileId || '';
      document.getElementById('panelMonitorDelivery').value = item.deliveryMethod || 'standard';
      document.getElementById('panelProxyGroup').value = item.proxyGroup || '';
      document.getElementById('taskModalTitle').textContent = 'Edit Monitor';
      document.getElementById('taskModalSaveBtn').textContent = 'Save Changes';
    } else {
      editingTaskId = item.id;
      toggleModalTaskType('checkout');
      document.getElementById('panelUrl').value = item.url || '';
      document.getElementById('panelQty').value = item.quantity || 20;
      document.getElementById('panelDelivery').value = item.deliveryMethod || 'standard';
      document.getElementById('panelProxyGroup').value = item.proxyGroup || '';

      // Very-specific fields
      if (item.module === 'very') {
        const pm = document.getElementById('panelPaymentMethod');
        if (pm) pm.value = item.paymentMethod || 'card';
        const cc = document.getElementById('panelCheckoutCount');
        if (cc) cc.value = item.checkoutCount || 1;
        const ccpc = document.getElementById('panelCCPostcode');
        if (ccpc) ccpc.value = item.ccPostcode || '';
        const ccs = document.getElementById('panelCCStore');
        if (ccs) ccs.value = item.ccStoreName || '';
        const promo = document.getElementById('panelPromoCode');
        if (promo) promo.value = item.promoCode || '';
      }

      // Profile selection (multi-select)
      if (item.profileIds && item.profileIds.length > 0) {
        selectedProfiles = [...item.profileIds];
      } else if (item.profileId) {
        selectedProfiles = [item.profileId];
      }
      // Check the appropriate checkboxes
      pmsOptions.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = selectedProfiles.includes(cb.value);
      });

      // Schedule
      if (item.schedule && item.schedule.enabled) {
        document.getElementById('panelScheduleType').value = item.schedule.type;
        document.getElementById('panelScheduleTime').value = item.schedule.time || '';
        document.getElementById('panelScheduleTime').style.display = 'block';
        if (item.schedule.type === 'once') {
          document.getElementById('panelScheduleDate').value = item.schedule.date || '';
          document.getElementById('panelScheduleDate').style.display = 'block';
        }
        if (item.schedule.type === 'weekly' && item.schedule.days) {
          document.getElementById('panelScheduleDays').style.display = 'flex';
          item.schedule.days.forEach(d => {
            const cb = document.querySelector(`#panelScheduleDays input[value="${d}"]`);
            if (cb) cb.checked = true;
          });
        }
      }

      document.getElementById('taskModalTitle').textContent = 'Edit Task';
      document.getElementById('taskModalSaveBtn').textContent = 'Save Changes';
    }
  }

  // Render profile tags in display
  renderProfileMultiSelectDisplay();

  // Very-specific field visibility
  updateVeryUI();

  // Show modal
  overlay.classList.add('active');
}

function closeTaskModal() {
  const overlay = document.getElementById('taskModalOverlay');
  if (overlay) overlay.classList.remove('active');
  panelMode = 'create';
  editingTaskId = null;
  editingMonitorId = null;
  selectedProfiles = [];
  // Close profile dropdown
  const pmsDropdown = document.getElementById('pmsDropdown');
  if (pmsDropdown) pmsDropdown.style.display = 'none';
}

function renderProfileMultiSelectDisplay() {
  const display = document.getElementById('pmsDisplay');
  if (!display) return;
  if (selectedProfiles.length === 0) {
    display.innerHTML = '<span class="pms-placeholder">Select profile(s)...</span>';
  } else {
    // Get profile names from the checkbox labels
    const tags = selectedProfiles.map(id => {
      const label = document.querySelector(`#pmsOptions input[value="${id}"]`)?.closest('.pms-option')?.querySelector('span');
      const name = label ? label.textContent.split(' (')[0] : id.slice(0, 8);
      return `<span class="pms-tag">${escapeHtml(name)}<button class="pms-tag-remove" data-id="${id}">&times;</button></span>`;
    }).join('');
    display.innerHTML = tags;
  }
}

// Process the task queue — starts tasks up to maxConcurrentTasks
async function processQueue() {
  if (queuePaused) return;
  const settings = await API.getSettings();
  const maxConcurrent = settings.maxConcurrentTasks || 3;
  while (runningTasks.size < maxConcurrent && taskQueue.length > 0) {
    const nextId = taskQueue.shift();
    // Verify task still exists and is idle
    const tasks = await API.getTasks();
    const task = tasks.find(t => t.id === nextId);
    if (task && (task.status === 'idle' || task.status === 'queued')) {
      runTask(nextId);
      await new Promise(r => setTimeout(r, 200)); // Small stagger
    }
  }
  try { await loadTasks(); } catch (e) {}
  try { await loadDashboard(); } catch (e) {}
}

// Periodic refresh while tasks are running or queued (keeps UI in sync)
setInterval(async () => {
  if (runningTasks.size > 0 || taskQueue.length > 0) {
    if (currentModule !== 'very') {
      try { await loadTasks(); } catch (e) {}
    }
    try { await loadDashboard(); } catch (e) {}
  }
}, 2000);

let _loadTasksLock = false;
async function loadTasks() {
  if (_loadTasksLock) return;
  _loadTasksLock = true;
  try {
  showSkeletons('tasksList', 'task', 3);
  const allTasks = await API.getTasks();
  const allMonitors = await API.getStockMonitors();
  // Filter by current module
  const moduleTasks = allTasks.filter(t => (t.module || 'freemans') === currentModule);
  const moduleMonitors = allMonitors.filter(m => (m.module || 'freemans') === currentModule);

  const container = document.getElementById('tasksList');
  const toolbar = document.getElementById('taskToolbar');

  if (!container || !toolbar) return;

  const totalItems = moduleTasks.length + moduleMonitors.length;

  // Always show toolbar (so + New Task is accessible) — but not for Very module
  if (currentModule !== 'very') toolbar.style.display = 'flex';

  if (totalItems === 0) {
    document.getElementById('taskCount').textContent = '0 tasks';
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div><div class="empty-state-text">No tasks yet. Click <strong>+ New Task</strong> to get started.</div></div>';
    return;
  }

  // Show all tasks + monitors (no filters)
  const counts = { idle: 0, running: 0, done: 0, error: 0 };
  moduleTasks.forEach(t => { if (counts[t.status] !== undefined) counts[t.status]++; });

  const queuedCount = moduleTasks.filter(t => taskQueue.includes(t.id) && t.status !== 'running').length;
  document.getElementById('taskCount').textContent =
    `${moduleTasks.length} task${moduleTasks.length !== 1 ? 's' : ''}` +
    (moduleMonitors.length ? ` · ${moduleMonitors.length} monitor${moduleMonitors.length !== 1 ? 's' : ''}` : '') +
    (counts.running ? ` · ${counts.running} running` : '') +
    (queuedCount ? ` · ${queuedCount} queued` : '') +
    (counts.done ? ` · ${counts.done} done` : '') +
    (counts.error ? ` · ${counts.error} failed` : '');

  // Cache profiles + proxy groups for meta display
  const allProfilesCache = await API.getProfiles();
  const allProxyGroupsCache = await API.getProxyGroups();

  // Render monitors first, then tasks — with checkboxes on left
  const monitorHTML = moduleMonitors.map(m => {
    const statusClass = m.lastStatus || 'unchecked';
    const statusText = m.lastStatus === 'in_stock' ? 'In Stock' : m.lastStatus === 'out_of_stock' ? 'Out of Stock' : 'Not checked';
    const lastChecked = m.lastChecked ? new Date(m.lastChecked).toLocaleTimeString() : 'Never';
    const intervalLabel = { 15000: '15s', 30000: '30s', 60000: '1m', 300000: '5m' }[m.checkInterval] || '30s';
    const mProfile = m.profileId ? (allProfilesCache.find(p => p.id === m.profileId)?.name || '') : '';
    const mProxy = m.proxyGroup ? (allProxyGroupsCache.find(g => g.id === m.proxyGroup)?.name || '') : '';
    return `
    <div class="task-card monitor-variant" data-monitor-id="${m.id}">
      <input type="checkbox" class="task-select-checkbox" data-select-id="${m.id}" data-select-type="monitor" ${selectedTasks.has(m.id) ? 'checked' : ''}>
      <span class="stock-status ${statusClass}"></span>
      <div class="task-card-inner">
        <div class="task-info">
          <div class="task-name">${escapeHtml(m.productName || 'Unnamed')}<span class="monitor-badge">MONITOR</span></div>
          <div class="task-detail">${escapeHtml(truncateUrl(m.productUrl))}</div>
          <div class="task-meta">
            <span class="task-meta-item">${statusText}</span>
            <span class="task-meta-item">Last: ${lastChecked}</span>
            <span class="task-meta-item">Every ${intervalLabel}</span>
            ${m.autoRun ? '<span class="task-meta-item" style="color:var(--primary);">Auto-run</span>' : ''}
            ${mProfile ? `<span class="task-meta-item">${escapeHtml(mProfile)}</span>` : ''}
            ${mProxy ? `<span class="task-meta-item">${escapeHtml(mProxy)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" data-action="edit-monitor" data-monitor-id="${m.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="task-action-btn ${m.enabled ? 'start' : ''}" data-action="toggle-monitor" data-monitor-id="${m.id}" title="${m.enabled ? 'Disable' : 'Enable'}">${m.enabled ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>'}</button>
        <button class="task-action-btn" data-action="check-now" data-monitor-id="${m.id}" title="Check now"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>
        <button class="task-action-btn delete" data-action="delete-monitor" data-monitor-id="${m.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </div>
    </div>`;
  }).join('');

  const taskHTML = moduleTasks.map(t => {
    const isRunning = t.status === 'running';
    const isDone = t.status === 'done';
    const isError = t.status === 'error';
    const isQueued = taskQueue.includes(t.id);
    const queuePos = isQueued ? taskQueue.indexOf(t.id) + 1 : 0;
    const progressData = runningTasks.get(t.id);
    const progressPct = progressData ? progressData.progress : (isDone ? 100 : isError ? 100 : 0);
    const barClass = isDone ? 'done' : isError ? 'error' : '';
    const displayStatus = isQueued && !isRunning ? 'queued' : (t.status || 'idle');
    const lines = Math.ceil(t.quantity / 6);
    const rem = t.quantity % 6 || 6;
    const lineInfo = lines <= 1 ? `1 line (qty ${t.quantity})` : `${lines} lines (${lines-1}×6 + 1×${rem})`;
    const duration = t.completedAt && t.startedAt ? ((t.completedAt - t.startedAt) / 1000).toFixed(1) + 's' : '';

    // Profile + proxy labels for meta row
    const profileLabel = t.profileIds?.length > 1
      ? `${t.profileIds.length} profiles`
      : t.profileId ? (allProfilesCache.find(p => p.id === t.profileId)?.name || 'Profile') : '';
    const proxyLabel = t.proxyGroup ? (allProxyGroupsCache.find(g => g.id === t.proxyGroup)?.name || 'Proxy') : '';
    const deliveryLabel = { standard: 'Standard', nextday: 'Next Day', express: 'Express', named: 'Named Day' }[t.deliveryMethod] || '';

    let detailText = truncateUrl(t.url);
    if (isDone) detailText = t.checkoutComplete ? '✓ Order Placed' : '✓ Completed';
    if (isRunning) detailText = progressData ? progressData.stepLabel : 'Starting...';
    if (isError) detailText = t.error || 'Failed';
    if (isQueued && !isRunning) detailText = `Queued (${queuePos}${queuePos===1?'st':queuePos===2?'nd':queuePos===3?'rd':'th'})`;

    // Checkout step tracker for running tasks
    const stepNum = progressData ? (progressData.step || 1) : 0;
    const stepTracker = isRunning ? `
      <div class="task-checkout-steps">
        <span class="step ${stepNum >= 1 ? (stepNum === 1 ? 'current' : 'active') : ''}">Cart</span>
        <span class="step-dot">›</span>
        <span class="step ${stepNum >= 2 ? (stepNum === 2 ? 'current' : 'active') : ''}">Login</span>
        <span class="step-dot">›</span>
        <span class="step ${stepNum >= 3 ? (stepNum === 3 ? 'current' : 'active') : ''}">Delivery</span>
        <span class="step-dot">›</span>
        <span class="step ${stepNum >= 4 ? (stepNum === 4 ? 'current' : 'active') : ''}">Payment</span>
        <span class="step-dot">›</span>
        <span class="step ${stepNum >= 5 ? (stepNum === 5 ? 'current' : 'active') : ''}">Confirm</span>
      </div>` : '';

    return `
    <div class="task-card${isRunning ? ' is-running' : ''}" data-id="${t.id}">
      <input type="checkbox" class="task-select-checkbox" data-select-id="${t.id}" data-select-type="task" ${selectedTasks.has(t.id) ? 'checked' : ''}>
      <span class="task-status-indicator ${displayStatus}"></span>
      <div class="task-card-inner">
        <div class="task-info">
          <div class="task-name">${escapeHtml(t.productCode || 'Freemans')} — Qty ${t.quantity}${t.retryCount ? ` <span class="retry-badge">Retry ${t.retryCount}</span>` : ''}${t.schedule?.enabled ? ` <span class="schedule-badge">\u23F0 ${t.schedule.time || ''}${t.schedule.type === 'daily' ? ' daily' : t.schedule.type === 'weekly' ? ' weekly' : ''}</span>` : ''}${t.profileIds?.length > 1 ? ` <span class="rotation-badge">\u21BB ${(t.profileRotationIndex || 0) + 1}/${t.profileIds.length}</span>` : ''}</div>
          <div class="task-detail">${detailText}</div>
          <div class="task-meta">
            <span class="task-meta-item">${lineInfo}</span>
            ${profileLabel ? `<span class="task-meta-item">${escapeHtml(profileLabel)}</span>` : ''}
            ${proxyLabel ? `<span class="task-meta-item">${escapeHtml(proxyLabel)}</span>` : ''}
            ${deliveryLabel ? `<span class="task-meta-item">${deliveryLabel}</span>` : ''}
            ${duration ? `<span class="task-meta-item">${duration}</span>` : ''}
          </div>
          ${stepTracker}
        </div>
        <div class="task-progress-track">
          <div class="task-progress-bar ${barClass}" id="progress-${t.id}" style="width:${progressPct}%"></div>
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn" data-action="edit" data-id="${t.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="task-action-btn" data-action="duplicate" data-id="${t.id}" title="Duplicate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
        ${isDone ? `<button class="task-action-btn checkout" data-action="checkout" title="Open Checkout">Checkout</button>` : ''}
        ${!isRunning ? `<button class="task-action-btn start" data-action="run" data-id="${t.id}" title="Run"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>` : `<button class="task-action-btn stop" data-action="stop" data-id="${t.id}" title="Stop"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>`}
        <button class="task-action-btn delete" data-action="delete" data-id="${t.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
      </div>
    </div>`;
  }).join('');

  // Combine: monitors first, then tasks
  container.innerHTML = monitorHTML + taskHTML;

  // Bind checkbox change events
  container.querySelectorAll('.task-select-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const selectId = cb.dataset.selectId;
      if (cb.checked) selectedTasks.add(selectId);
      else selectedTasks.delete(selectId);
      updateBulkBar();
    });
    cb.addEventListener('click', (e) => e.stopPropagation());
  });

  // Bind task actions
  container.querySelectorAll('.task-action-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const monitorId = btn.dataset.monitorId;

      // Edit actions
      if (action === 'edit-monitor' && monitorId) {
        const monitors = await API.getStockMonitors();
        const m = monitors.find(x => x.id === monitorId);
        if (m) openTaskModal('edit', m);
        return;
      }
      if (action === 'edit' && id) {
        const tasks = await API.getTasks();
        const t = tasks.find(x => x.id === id);
        if (t) openTaskModal('edit', t);
        return;
      }

      // Monitor actions
      if (action === 'delete-monitor' && monitorId) {
        const yes = await showConfirm('Delete this monitor?', 'Delete');
        if (yes) { await API.deleteStockMonitor(monitorId); toast('Monitor deleted', 'info'); loadTasks(); }
        return;
      }
      if (action === 'toggle-monitor' && monitorId) {
        const monitors = await API.getStockMonitors();
        const m = monitors.find(x => x.id === monitorId);
        if (m) { m.enabled = !m.enabled; await API.saveStockMonitor(m); toast(m.enabled ? 'Monitor enabled' : 'Monitor paused', 'info'); loadTasks(); }
        return;
      }
      if (action === 'check-now' && monitorId) {
        const monitors = await API.getStockMonitors();
        const m = monitors.find(x => x.id === monitorId);
        if (m) {
          toast('Checking stock...', 'info');
          const result = await API.checkStock({ url: m.productUrl });
          m.lastChecked = Date.now();
          m.lastStatus = result.inStock ? 'in_stock' : 'out_of_stock';
          await API.saveStockMonitor(m);
          toast(result.inStock ? `${m.productName} is IN STOCK!` : `${m.productName} is out of stock`, result.inStock ? 'success' : 'info');
          loadTasks();
        }
        return;
      }

      // Task actions
      if (action === 'delete') {
        const yes = await showConfirm('Delete this task?', 'Delete');
        if (yes) { await API.deleteTask(id); toast('Task deleted', 'info'); loadTasks(); }
      } else if (action === 'run') {
        runTask(id);
      } else if (action === 'stop') {
        const tasks = await API.getTasks();
        const task = tasks.find(t => t.id === id);
        if (task) {
          task.status = 'error';
          task.error = 'Stopped by user';
          task.completedAt = Date.now();
          await API.saveTask(task);
          runningTasks.delete(id);
          // Remove from queue if queued
          const qIdx = taskQueue.indexOf(id);
          if (qIdx !== -1) taskQueue.splice(qIdx, 1);
          toast('Task stopped', 'info');
          try { await loadTasks(); } catch (e) {}
          try { await loadDashboard(); } catch (e) {}
        }
      } else if (action === 'duplicate') {
        duplicateTask(id);
      } else if (action === 'checkout') {
        API.openCheckout();
        toast('Opened checkout', 'info');
      }
    });
  });
  } finally { _loadTasksLock = false; }
}

function truncateUrl(url) {
  if (!url) return '';
  try { const u = new URL(url); return u.pathname.length > 40 ? u.pathname.slice(0, 40) + '...' : u.pathname; }
  catch { return url.slice(0, 50); }
}

async function duplicateTask(id) {
  const tasks = await API.getTasks();
  const orig = tasks.find(t => t.id === id);
  if (!orig) return;
  const task = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    url: orig.url, quantity: orig.quantity, profileId: orig.profileId,
    deliveryMethod: orig.deliveryMethod || 'standard',
    module: orig.module || 'freemans',
    status: 'idle', productCode: null, error: null, createdAt: Date.now()
  };
  if (orig.profileIds) { task.profileIds = [...orig.profileIds]; task.profileRotationIndex = 0; }
  if (orig.schedule) { task.schedule = { ...orig.schedule, lastRun: null, enabled: orig.schedule.enabled }; }
  await API.saveTask(task);
  toast('Task duplicated', 'success');
  loadTasks();
}

async function runTask(id) {
  console.log('[runTask] Starting task:', id);
  const tasks = await API.getTasks();
  const task = tasks.find(t => t.id === id);
  if (!task) { console.log('[runTask] Task not found:', id); return; }

  task.status = 'running';
  task.error = null;
  task.startedAt = Date.now();
  task.completedAt = null;
  await API.saveTask(task);

  toast(`Task started — Qty ${task.quantity}`, 'info');
  runningTasks.set(id, { progress: 5, step: 1, stepLabel: 'Adding to bag...' });
  try { await loadTasks(); } catch (e) {}
  try { await loadDashboard(); } catch (e) {}

  const lines = Math.ceil(task.quantity / 6);
  const totalSteps = lines + 2;

  const progressInterval = setInterval(() => {
    try {
      const data = runningTasks.get(id);
      if (data && data.progress < 90) {
        data.progress = Math.min(90, data.progress + (85 / totalSteps / 2));
        const bar = document.getElementById(`progress-${id}`);
        if (bar) bar.style.width = data.progress + '%';
      }
    } catch (e) { /* DOM element may not exist if user on different page */ }
  }, 400);

  // Resolve the profile if attached (supports rotation)
  let profile = null;
  if (task.profileIds && task.profileIds.length > 0) {
    // Rotation mode — pick next profile
    const idx = task.profileRotationIndex || 0;
    const profiles = await API.getProfiles();
    profile = profiles.find(p => p.id === task.profileIds[idx]) || null;
    // Advance rotation for next run
    task.profileRotationIndex = (idx + 1) % task.profileIds.length;
    await API.saveTask(task);
  } else if (task.profileId) {
    const profiles = await API.getProfiles();
    profile = profiles.find(p => p.id === task.profileId) || null;
  }

  // Resolve proxy group name for logging/webhooks
  let proxyGroupName = null;
  if (task.proxyGroup) {
    const pgs = await API.getProxyGroups();
    const pg = pgs.find(g => g.id === task.proxyGroup);
    if (pg) proxyGroupName = pg.name;
  }

  // Module-aware dispatch
  let result;
  const taskModule = task.module || 'freemans';
  try {
    if (taskModule === 'freemans') {
      result = await API.freemansRun({ productUrl: task.url, quantity: task.quantity, taskId: id, profile, deliveryMethod: task.deliveryMethod || 'standard' });
    } else if (taskModule === 'very') {
      const verySettings = await API.getSettings();
      const isDryRun = document.getElementById('veryTrialRun')?.checked || verySettings.dryRun || false;
      result = await API.veryRun({
        cartLink: task.url,
        taskId: id,
        profile: profile ? {
          email: profile.email,
          password: profile.password,
          postcode: profile.postcode || profile.shipPostcode || '',
          cvv: profile.cvv || ''
        } : null,
        deliveryMethod: task.deliveryMethod || 'standard',
        paymentMethod: task.paymentMethod || 'card',
        ccPostcode: task.ccPostcode || '',
        ccStoreName: task.ccStoreName || '',
        promoCode: task.promoCode || '',
        dryRun: isDryRun
      });
    } else {
      result = { success: false, error: `Module "${taskModule}" is not yet available` };
    }
  } catch (err) {
    console.error('[runTask] Exception:', err);
    result = { success: false, error: err.message || 'Unknown error during task execution' };
  }

  console.log('[runTask] Result:', JSON.stringify(result));
  clearInterval(progressInterval);
  runningTasks.delete(id);

  const settings = await API.getSettings();

  if (result.success) {
    task.status = 'done';
    task.productCode = result.productCode;
    task.completedAt = Date.now();
    task.checkoutComplete = !!result.checkoutComplete;
    task.orderNumber = result.orderNumber || null;
    const dur = ((task.completedAt - task.startedAt) / 1000).toFixed(1);

    const statsUpdate = { tasksRun: 1, itemsAdded: result.quantity };
    if (result.checkoutComplete) statsUpdate.checkouts = 1;
    await API.updateStats(statsUpdate);

    let msg, logMsg;
    if (result.checkoutComplete) {
      const orderTag = result.orderNumber ? ` (Order #${result.orderNumber})` : '';
      msg = `Order placed! — ${result.quantity} items checked out${orderTag}`;
      logMsg = `<strong>Order placed</strong> — ${result.productCode} × ${result.quantity} in ${dur}s${orderTag}`;
    } else {
      const checkoutMsg = result.checkoutError ? ` · ${result.checkoutError}` : '';
      msg = `Task complete — ${result.quantity} items added${checkoutMsg}`;
      logMsg = `<strong>Task complete</strong> — ${result.productCode} × ${result.quantity} (${result.lines} lines) in ${dur}s${checkoutMsg}`;
    }
    toast(msg, 'success');
    sessionTasksRun++;

    // Sound notification
    if (settings.notificationSound) playSound('success');

    // Desktop notification
    if (settings.desktopNotifications) {
      API.showNotification({
        title: result.checkoutComplete ? 'Order Placed!' : 'Task Complete',
        body: result.checkoutComplete
          ? `${result.productCode} × ${result.quantity} — Order #${result.orderNumber || 'N/A'}`
          : `${result.productCode} × ${result.quantity} added to bag`
      });
    }

    // Webhook
    if (settings.webhookUrl) {
      sendWebhook(settings.webhookUrl, buildDiscordEmbed('success', {
        productCode: result.productCode, quantity: result.quantity, duration: dur + 's',
        orderNumber: result.orderNumber, profile: profile ? profile.name : null,
        proxyGroup: proxyGroupName, delivery: task.deliveryMethod || 'standard',
        module: taskModule, checkoutComplete: result.checkoutComplete,
        price: result.price || null
      }));
    }

    // Auto-clear completed
    if (settings.autoClearCompleted) {
      await API.deleteTask(id);
    }
  } else {
    // Check if error is retryable
    const NON_RETRYABLE = ['login failed', 'no card details', 'stopped by user', 'module', 'not yet available', 'captcha'];
    const errorLower = (result.error || '').toLowerCase();
    const isRetryable = !NON_RETRYABLE.some(e => errorLower.includes(e));
    const retryCount = task.retryCount || 0;
    const maxRetries = settings.maxRetries ?? 3;
    const retryDelay = settings.retryDelay || 5000;

    if (isRetryable && retryCount < maxRetries) {
      // Auto-retry
      task.retryCount = retryCount + 1;
      task.status = 'idle';
      task.error = null;
      task.completedAt = null;
      await API.saveTask(task);
      toast(`Retrying task (${task.retryCount}/${maxRetries})...`, 'info');
      try { await loadTasks(); } catch (e) {}
      try { await loadDashboard(); } catch (e) {}
      // Schedule retry after delay
      setTimeout(() => {
        runTask(id);
      }, retryDelay);
      return; // Skip the rest (save, tracking, etc.) — will happen after retry
    }

    task.status = 'error';
    task.error = result.error;
    task.completedAt = Date.now();
    const retryTag = retryCount > 0 ? ` (after ${retryCount} retries)` : '';
    toast(`Task failed: ${result.error}${retryTag}`, 'error', 5000);
    logError(`Task failed: ${result.error}${retryTag}`, { module: taskModule, taskId: id, step: result.checkoutStep || null });

    // Sound notification
    if (settings.notificationSound) playSound('error');

    // Desktop notification
    if (settings.desktopNotifications) {
      API.showNotification({
        title: 'Task Failed',
        body: result.error || 'Unknown error'
      });
    }

    // Webhook
    if (settings.webhookUrl) {
      sendWebhook(settings.webhookUrl, buildDiscordEmbed('error', {
        error: result.error + retryTag, productCode: result.productCode,
        profile: profile ? profile.name : null, proxyGroup: proxyGroupName,
        step: result.checkoutStep || null, module: taskModule
      }));
    }
  }

  // Supabase checkout tracking (fire-and-forget)
  try {
    const { key } = await API.checkKey();
    API.logCheckout({
      license_key: key || 'unknown',
      product_code: result.productCode || null,
      quantity: task.quantity,
      order_number: result.orderNumber || null,
      profile_name: profile ? profile.name : null,
      proxy_group_name: proxyGroupName || null,
      delivery_method: task.deliveryMethod || 'standard',
      price: result.price || null,
      module: taskModule,
      status: result.success ? 'success' : 'failed',
      error: result.success ? null : (result.error || null),
      duration_seconds: task.completedAt && task.startedAt ? parseFloat(((task.completedAt - task.startedAt) / 1000).toFixed(1)) : null
    });
  } catch (e) { /* tracking should never break the app */ }

  await API.saveTask(task);
  try { await loadTasks(); } catch (e) {}
  try { await loadDashboard(); } catch (e) {}

  // Process queue — start next task if available
  processQueue();
}

// Webhook helper — Discord rich embeds
function buildDiscordEmbed(type, data) {
  const colors = { success: 0x00b894, error: 0xe74c3c, info: 0xF97316 };
  const moduleName = data.module || 'Freemans';

  if (type === 'success') {
    const mode = data.checkoutComplete ? 'Checkout' : 'Add to Bag';
    const fields = [
      { name: 'Site', value: moduleName, inline: true },
      { name: 'Mode', value: mode, inline: true },
      { name: 'Product', value: data.productCode || '—', inline: false },
      { name: 'Quantity', value: String(data.quantity || 0), inline: true },
      { name: 'Duration', value: data.duration || '—', inline: true }
    ];
    if (data.orderNumber) fields.push({ name: 'Order #', value: `\`${data.orderNumber}\``, inline: true });
    if (data.price) fields.push({ name: 'Price', value: data.price, inline: true });
    if (data.profile) fields.push({ name: 'Profile', value: data.profile, inline: true });
    if (data.proxyGroup) fields.push({ name: 'Proxy', value: data.proxyGroup, inline: true });
    if (data.delivery) fields.push({ name: 'Delivery', value: data.delivery, inline: true });
    return {
      embeds: [{
        title: data.checkoutComplete ? 'Successful Checkout' : 'Task Complete',
        description: data.checkoutComplete
          ? `Order placed for **${data.productCode || 'product'}** x${data.quantity || 0}`
          : `Added **${data.productCode || 'product'}** x${data.quantity || 0} to bag`,
        color: colors.success,
        fields,
        footer: { text: `Murph AIO` },
        timestamp: new Date().toISOString()
      }]
    };
  } else {
    const fields = [
      { name: 'Site', value: moduleName, inline: true }
    ];
    if (data.productCode) fields.push({ name: 'Product', value: data.productCode, inline: true });
    fields.push({ name: 'Error', value: `\`\`\`${data.error || 'Unknown error'}\`\`\``, inline: false });
    if (data.profile) fields.push({ name: 'Profile', value: data.profile, inline: true });
    if (data.proxyGroup) fields.push({ name: 'Proxy', value: data.proxyGroup, inline: true });
    if (data.step) fields.push({ name: 'Failed At', value: data.step, inline: true });
    return {
      embeds: [{
        title: 'Checkout Failed',
        color: colors.error,
        fields,
        footer: { text: `Murph AIO` },
        timestamp: new Date().toISOString()
      }]
    };
  }
}

async function sendWebhook(url, payload) {
  try { await API.sendWebhook(url, payload); } catch (e) { /* silent */ }
}

// ============================================================
// NOTIFICATION SOUNDS (Web Audio API — no external files)
// ============================================================
async function playSound(type) {
  try {
    // For success, check if user has a custom sound file
    if (type === 'success') {
      const settings = await API.getSettings();
      if (settings.checkoutSound) {
        try {
          const folder = await API.getSoundsFolder();
          const audio = new Audio(`file://${folder}/${settings.checkoutSound}`);
          audio.volume = 0.5;
          audio.play().catch(() => {});
          return;
        } catch (e) { /* Fall through to default */ }
      }
    }

    // Default Web Audio API sounds
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = 0.15;

    if (type === 'success') {
      // Rising two-tone chime
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 523.25; // C5
      o1.connect(gain);
      o1.start(ctx.currentTime);
      o1.stop(ctx.currentTime + 0.12);

      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 659.25; // E5
      o2.connect(gain);
      o2.start(ctx.currentTime + 0.14);
      o2.stop(ctx.currentTime + 0.26);

      const o3 = ctx.createOscillator();
      o3.type = 'sine';
      o3.frequency.value = 783.99; // G5
      o3.connect(gain);
      o3.start(ctx.currentTime + 0.28);
      o3.stop(ctx.currentTime + 0.5);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
      setTimeout(() => ctx.close(), 600);
    } else {
      // Descending two-tone (error)
      const o1 = ctx.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 440; // A4
      o1.connect(gain);
      o1.start(ctx.currentTime);
      o1.stop(ctx.currentTime + 0.15);

      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 330; // E4
      o2.connect(gain);
      o2.start(ctx.currentTime + 0.18);
      o2.stop(ctx.currentTime + 0.4);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      setTimeout(() => ctx.close(), 500);
    }
  } catch (e) { /* Audio not available */ }
}

// Start All
document.getElementById('startAllBtn').addEventListener('click', async () => {
  const tasks = await API.getTasks();
  const idle = tasks.filter(t =>
    (t.module || 'freemans') === currentModule &&
    (t.status === 'idle' || t.status === 'error')
  );
  if (idle.length === 0) { toast('No idle tasks to start', 'info'); return; }

  queuePaused = false;
  // Add all idle tasks to queue
  for (const t of idle) {
    if (!taskQueue.includes(t.id)) {
      taskQueue.push(t.id);
    }
  }

  toast(`Queued ${idle.length} task${idle.length !== 1 ? 's' : ''}`, 'info');
  try { await loadTasks(); } catch (e) {}
  processQueue();
});

// Stop All
document.getElementById('stopAllBtn').addEventListener('click', async () => {
  // Clear the queue first
  taskQueue.length = 0;
  queuePaused = false;

  const tasks = await API.getTasks();
  const running = tasks.filter(t =>
    (t.module || 'freemans') === currentModule &&
    t.status === 'running'
  );
  if (running.length === 0) { toast('No running tasks to stop', 'info'); return; }
  for (const t of running) {
    t.status = 'error';
    t.error = 'Stopped by user';
    t.completedAt = Date.now();
    runningTasks.delete(t.id);
    await API.saveTask(t);
  }
  toast(`Stopped ${running.length} task${running.length !== 1 ? 's' : ''}`, 'info');
  try { await loadTasks(); } catch (e) {}
  try { await loadDashboard(); } catch (e) {}
});

// Pause Queue
document.getElementById('pauseQueueBtn')?.addEventListener('click', () => {
  queuePaused = true;
  toast('Queue paused — running tasks will finish', 'info');
  try { loadTasks(); } catch (e) {}
});

// Resume Queue
document.getElementById('resumeQueueBtn')?.addEventListener('click', async () => {
  queuePaused = false;
  // Re-queue any idle tasks not already queued
  const tasks = await API.getTasks();
  const idle = tasks.filter(t =>
    (t.module || 'freemans') === currentModule &&
    t.status === 'idle' && !taskQueue.includes(t.id)
  );
  for (const t of idle) taskQueue.push(t.id);
  toast('Queue resumed', 'info');
  processQueue();
});

// ============================================================
// TASK MODAL — Event Listeners (v2.0)
// ============================================================

// + New Task button
document.getElementById('createTaskBtn').addEventListener('click', () => {
  openTaskModal('create');
});

// Type toggle buttons (Checkout / Monitor)
document.querySelectorAll('.type-toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    toggleModalTaskType(btn.dataset.type);
  });
});

// Modal schedule type toggle
document.getElementById('panelScheduleType').addEventListener('change', (e) => {
  const type = e.target.value;
  document.getElementById('panelScheduleTime').style.display = type ? 'block' : 'none';
  document.getElementById('panelScheduleDate').style.display = type === 'once' ? 'block' : 'none';
  document.getElementById('panelScheduleDays').style.display = type === 'weekly' ? 'flex' : 'none';
});

// Monitor auto-run toggle
document.getElementById('panelMonitorAutoRun').addEventListener('change', (e) => {
  document.getElementById('panelMonitorAutoRunFields').style.display = e.target.checked ? 'block' : 'none';
});

// Profile multi-select: toggle dropdown
document.getElementById('pmsDisplay').addEventListener('click', (e) => {
  // Don't toggle if clicking a tag remove button
  if (e.target.classList.contains('pms-tag-remove')) return;
  const dropdown = document.getElementById('pmsDropdown');
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
});

// Profile multi-select: checkbox changes
document.getElementById('pmsOptions').addEventListener('change', (e) => {
  if (e.target.type !== 'checkbox') return;
  const id = e.target.value;
  if (e.target.checked) {
    if (!selectedProfiles.includes(id)) selectedProfiles.push(id);
  } else {
    selectedProfiles = selectedProfiles.filter(x => x !== id);
  }
  renderProfileMultiSelectDisplay();
});

// Profile multi-select: tag remove buttons (delegated)
document.getElementById('pmsDisplay').addEventListener('click', (e) => {
  if (e.target.classList.contains('pms-tag-remove')) {
    e.stopPropagation();
    const id = e.target.dataset.id;
    selectedProfiles = selectedProfiles.filter(x => x !== id);
    // Uncheck the checkbox
    const cb = document.querySelector(`#pmsOptions input[value="${id}"]`);
    if (cb) cb.checked = false;
    renderProfileMultiSelectDisplay();
  }
});

// Close profile dropdown when clicking outside
document.addEventListener('click', (e) => {
  const pms = document.getElementById('profileMultiSelect');
  const dropdown = document.getElementById('pmsDropdown');
  if (pms && dropdown && !pms.contains(e.target)) {
    dropdown.style.display = 'none';
  }
});

// Task modal cancel
document.getElementById('taskModalCancel').addEventListener('click', () => {
  closeTaskModal();
});

// Task modal overlay mousedown fix
const taskModalOverlay = document.getElementById('taskModalOverlay');
taskModalOverlay.addEventListener('mousedown', (e) => { taskModalOverlay._mouseDownOnOverlay = (e.target === taskModalOverlay); });
taskModalOverlay.addEventListener('mouseup', (e) => {
  if (e.target === taskModalOverlay && taskModalOverlay._mouseDownOnOverlay) closeTaskModal();
  taskModalOverlay._mouseDownOnOverlay = false;
});

// Kebab menu toggle
document.getElementById('kebabBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('kebabMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});
// Close kebab on outside click
document.addEventListener('click', () => {
  const menu = document.getElementById('kebabMenu');
  if (menu) menu.style.display = 'none';
});

// Task modal save / create button
document.getElementById('taskModalSaveBtn').addEventListener('click', async () => {
  const isMonitor = currentTaskType === 'monitor';
  const cfg = MODULE_CONFIG[currentModule];

  if (isMonitor) {
    // ---- Monitor create / save ----
    const url = document.getElementById('panelUrl').value.trim();
    const name = document.getElementById('panelMonitorName').value.trim();
    if (!url) { toast('Enter a product URL', 'error'); return; }
    if (!name) { toast('Enter a product name', 'error'); return; }

    const monitor = {
      id: editingMonitorId || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
      productUrl: url,
      productName: name,
      module: currentModule,
      checkInterval: parseInt(document.getElementById('panelMonitorInterval').value) || 30000,
      enabled: true,
      autoRun: document.getElementById('panelMonitorAutoRun').checked,
      profileId: document.getElementById('panelMonitorProfile').value || '',
      quantity: parseInt(document.getElementById('panelMonitorQty').value) || 20,
      deliveryMethod: document.getElementById('panelMonitorDelivery').value || 'standard',
      proxyGroup: document.getElementById('panelProxyGroup').value || '',
      lastChecked: null,
      lastStatus: null,
      notified: false,
      createdAt: editingMonitorId ? undefined : Date.now()
    };

    await API.saveStockMonitor(monitor);
    const verb = editingMonitorId ? 'updated' : 'created';
    toast(`Monitor "${name}" ${verb}`, 'success');
    closeTaskModal();
    loadTasks();
  } else {
    // ---- Checkout task create / save ----
    const url = document.getElementById('panelUrl').value.trim();
    const qty = parseInt(document.getElementById('panelQty').value) || 0;

    if (!url || !url.includes(cfg.urlPattern)) { toast(`Enter a valid ${cfg.name} product URL`, 'error'); return; }
    if (qty < 1) { toast('Enter a valid quantity', 'error'); return; }

    // Profile from multi-select
    const profileId = selectedProfiles.length === 1 ? selectedProfiles[0] : '';
    let profileIds = selectedProfiles.length > 1 ? [...selectedProfiles] : [];

    // Schedule
    const scheduleType = document.getElementById('panelScheduleType').value;
    let schedule = null;
    if (scheduleType) {
      const time = document.getElementById('panelScheduleTime').value;
      if (!time) { toast('Enter a schedule time', 'error'); return; }
      schedule = { enabled: true, type: scheduleType, time, lastRun: null };
      if (scheduleType === 'once') {
        const date = document.getElementById('panelScheduleDate').value;
        if (!date) { toast('Enter a schedule date', 'error'); return; }
        schedule.date = date;
      }
      if (scheduleType === 'weekly') {
        const days = Array.from(document.querySelectorAll('#panelScheduleDays input:checked')).map(cb => parseInt(cb.value));
        if (days.length === 0) { toast('Select at least one day', 'error'); return; }
        schedule.days = days;
      }
    }

    const deliveryMethod = document.getElementById('panelDelivery').value;
    const proxyGroup = document.getElementById('panelProxyGroup').value || '';

    // Very-specific fields
    const paymentMethod = document.getElementById('panelPaymentMethod')?.value || 'card';
    const checkoutCount = parseInt(document.getElementById('panelCheckoutCount')?.value) || 1;
    const ccPostcode = document.getElementById('panelCCPostcode')?.value || '';
    const ccStoreName = document.getElementById('panelCCStore')?.value || '';
    const promoCode = document.getElementById('panelPromoCode')?.value || '';

    if (panelMode === 'edit' && editingTaskId) {
      // Update existing task
      const tasks = await API.getTasks();
      const existing = tasks.find(t => t.id === editingTaskId);
      if (existing) {
        existing.url = url;
        existing.quantity = qty;
        existing.profileId = profileId;
        existing.deliveryMethod = deliveryMethod;
        existing.proxyGroup = proxyGroup;
        if (currentModule === 'very') {
          existing.paymentMethod = paymentMethod;
          existing.checkoutCount = checkoutCount;
          existing.ccPostcode = ccPostcode;
          existing.ccStoreName = ccStoreName;
          existing.promoCode = promoCode;
        }
        if (profileIds.length > 0) {
          existing.profileIds = profileIds;
          existing.profileRotationIndex = existing.profileRotationIndex || 0;
        } else {
          delete existing.profileIds;
          delete existing.profileRotationIndex;
        }
        if (schedule) existing.schedule = schedule;
        else delete existing.schedule;
        await API.saveTask(existing);
        toast('Task updated', 'success');
      }
    } else {
      // Create new task(s) — for Very, checkoutCount creates multiple tasks
      const tasksToCreate = (currentModule === 'very') ? checkoutCount : 1;
      for (let i = 0; i < tasksToCreate; i++) {
        const task = {
          id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
          url, quantity: qty, profileId, deliveryMethod, proxyGroup,
          module: currentModule,
          status: 'idle', productCode: null, error: null, createdAt: Date.now()
        };
        if (currentModule === 'very') {
          task.paymentMethod = paymentMethod;
          task.ccPostcode = ccPostcode;
          task.ccStoreName = ccStoreName;
          task.promoCode = promoCode;
        }
        if (profileIds.length > 0) {
          task.profileIds = profileIds;
          task.profileRotationIndex = 0;
        }
        if (schedule) task.schedule = schedule;
        await API.saveTask(task);
      }
      const countTag = tasksToCreate > 1 ? ` (${tasksToCreate} tasks)` : '';
      const scheduleTag = schedule ? ` (scheduled ${schedule.type === 'once' ? schedule.date + ' ' : ''}${schedule.time})` : '';
      toast('Task created' + countTag + scheduleTag, 'success');
    }

    closeTaskModal();
    loadTasks();
  }
});

// Clear all (module-scoped) — now in kebab menu
document.getElementById('clearTasksBtn').addEventListener('click', async () => {
  const cfg = MODULE_CONFIG[currentModule];
  const yes = await showConfirm(`Clear all ${cfg.name} tasks? This cannot be undone.`, 'Clear All');
  if (yes) {
    const allTasks = await API.getTasks();
    const toDelete = allTasks.filter(t => (t.module || 'freemans') === currentModule);
    for (const t of toDelete) { await API.deleteTask(t.id); }
    // Also clear monitors
    const allMonitors = await API.getStockMonitors();
    const monitorsToDelete = allMonitors.filter(m => (m.module || 'freemans') === currentModule);
    for (const m of monitorsToDelete) { await API.deleteStockMonitor(m.id); }
    toast('All tasks and monitors cleared', 'info');
    loadTasks();
  }
});

// ============================================================
// PROFILES
// ============================================================
let editingProfileId = null;
let currentProfileTab = 'login';
let cardRevealed = false;
let realCardNumber = '';

// Setup tab switching (Profiles | Proxies)
document.querySelectorAll('.setup-tab[data-setup-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    const section = tab.dataset.setupTab;
    document.querySelectorAll('.setup-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const profilesSec = document.getElementById('setup-profiles');
    const proxiesSec = document.getElementById('setup-proxies');
    if (profilesSec) profilesSec.style.display = section === 'profiles' ? 'block' : 'none';
    if (proxiesSec) proxiesSec.style.display = section === 'proxies' ? 'block' : 'none';
    if (section === 'proxies') renderProxyGroups();
  });
});

// Error log collapsible toggle
document.getElementById('errorLogToggle')?.addEventListener('click', () => {
  const body = document.getElementById('errorLogBody');
  const chevron = document.querySelector('.collapsible-chevron');
  if (body) {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (chevron) chevron.textContent = isOpen ? '\u25B8' : '\u25BE';
    if (!isOpen) renderErrorLog();
  }
});

// Profile tab click handlers
document.querySelectorAll('[data-profile-tab]').forEach(tab => {
  tab.addEventListener('click', () => {
    currentProfileTab = tab.dataset.profileTab;
    document.querySelectorAll('[data-profile-tab]').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadProfiles();
  });
});

async function loadProfiles() {
  showSkeletons('profilesList', 'profile', 3);
  const allProfiles = await API.getProfiles();
  const container = document.getElementById('profilesList');
  const searchWrap = document.getElementById('profileSearchWrap');

  if (!container || !searchWrap) return;

  // Filter by tab: login = existingAccount:true, guest = existingAccount:false/undefined
  const tabFiltered = currentProfileTab === 'login'
    ? allProfiles.filter(p => !!p.existingAccount)
    : allProfiles.filter(p => !p.existingAccount);

  // Show/hide search bar based on profile count
  searchWrap.style.display = tabFiltered.length > 0 ? 'block' : 'none';

  const emptyLabel = currentProfileTab === 'login' ? 'Login Account' : 'Guest Profile';
  if (tabFiltered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="empty-state-text">No ${emptyLabel.toLowerCase()}s yet. Click <strong>New Profile</strong> to add one.</div></div>`;
    return;
  }

  // Filter by search
  const profiles = profileSearchQuery
    ? tabFiltered.filter(p => {
        const searchText = [p.name, p.firstName, p.lastName, p.email, p.postcode, p.phone].join(' ').toLowerCase();
        return searchText.includes(profileSearchQuery);
      })
    : tabFiltered;

  if (profiles.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><div class="empty-state-text">No profiles matching "${escapeHtml(profileSearchQuery)}"</div></div>`;
    return;
  }

  container.innerHTML = profiles.map(p => {
    const isExisting = !!p.existingAccount;
    const typeBadge = isExisting
      ? '<span class="profile-type-badge existing">Login</span>'
      : '<span class="profile-type-badge new-acct">Guest</span>';
    let detailRows = '';
    if (isExisting) {
      detailRows += `<div class="profile-card-row"><span class="profile-card-label">Email</span><span class="profile-card-value">${escapeHtml(p.email || '—')}</span></div>`;
    } else {
      detailRows += `<div class="profile-card-row"><span class="profile-card-label">Name</span><span class="profile-card-value">${escapeHtml((p.firstName||'') + ' ' + (p.lastName||''))}</span></div>`;
      const addrParts = [p.address1 || p.houseNum, p.city, p.postcode].filter(Boolean);
      detailRows += `<div class="profile-card-row"><span class="profile-card-label">Address</span><span class="profile-card-value">${escapeHtml(addrParts.join(', ') || '—')}</span></div>`;
      detailRows += `<div class="profile-card-row"><span class="profile-card-label">Email</span><span class="profile-card-value">${escapeHtml(p.email || '—')}</span></div>`;
    }
    const cardRow = `<div class="profile-card-row"><span class="profile-card-label">Card</span><span class="profile-card-value">${p.cardNumber ? '•••• ' + p.cardNumber.slice(-4) : '—'}</span></div>`;
    return `
    <div class="profile-card" data-id="${p.id}">
      <div class="profile-card-header">
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="profile-card-name">${escapeHtml(p.name || 'Unnamed')}</div>
          ${typeBadge}
        </div>
        <div class="profile-card-actions">
          <button class="profile-card-action edit" data-action="edit-profile" data-id="${p.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          <button class="profile-card-action" data-action="duplicate-profile" data-id="${p.id}" title="Duplicate"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>
          <button class="profile-card-action delete" data-action="delete-profile" data-id="${p.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
        </div>
      </div>
      ${detailRows}
      ${cardRow}
    </div>`;
  }).join('');

  container.querySelectorAll('[data-action="delete-profile"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const yes = await showConfirm('Delete this profile?', 'Delete');
      if (yes) { await API.deleteProfile(btn.dataset.id); toast('Profile deleted', 'info'); loadProfiles(); }
    });
  });

  container.querySelectorAll('[data-action="duplicate-profile"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const profiles = await API.getProfiles();
      const p = profiles.find(x => x.id === btn.dataset.id);
      if (!p) return;
      const dup = { ...p };
      dup.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
      dup.name = (p.name || 'Profile') + ' (Copy)';
      dup.createdAt = Date.now();
      await API.saveProfile(dup);
      toast('Profile duplicated', 'success');
      loadProfiles();
    });
  });

  container.querySelectorAll('[data-action="edit-profile"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const profiles = await API.getProfiles();
      const p = profiles.find(x => x.id === btn.dataset.id);
      if (!p) return;
      editingProfileId = p.id;
      const isLogin = !!p.existingAccount;

      // Set site selector
      const siteSelect = document.getElementById('profSite');
      if (siteSelect) {
        siteSelect.value = p.site || (isLogin ? 'very' : 'freemans');
      }
      updateProfileFieldsBySite(p.site || (isLogin ? 'very' : 'freemans'));

      // Profile name
      document.getElementById('profName').value = p.name || '';

      if (isLogin) {
        // Login fields
        document.getElementById('profEmail').value = p.email || '';
        document.getElementById('profPassword').value = p.password || '';
        if (document.getElementById('profPostcode')) {
          document.getElementById('profPostcode').value = p.postcode || '';
        }
      } else {
        // Guest contact
        document.getElementById('profGuestEmail').value = p.email || '';
        document.getElementById('profGuestPhone').value = p.phone || '';
        // Guest shipping
        document.getElementById('profShipFirst').value = p.firstName || '';
        document.getElementById('profShipLast').value = p.lastName || '';
        document.getElementById('profShipAddr1').value = p.address1 || '';
        document.getElementById('profShipAddr2').value = p.address2 || p.houseNum || '';
        document.getElementById('profShipCity').value = p.city || '';
        document.getElementById('profShipCounty').value = p.county || '';
        document.getElementById('profShipPostcode').value = p.postcode || '';
        document.getElementById('profShipCountry').value = p.country || 'GB';
        // Guest billing
        const billSame = p.billingSame !== false;
        document.getElementById('profBillingSame').checked = billSame;
        document.getElementById('profBillingFields').style.display = billSame ? 'none' : 'block';
        if (!billSame) {
          document.getElementById('profBillFirst').value = p.billFirstName || '';
          document.getElementById('profBillLast').value = p.billLastName || '';
          document.getElementById('profBillAddr1').value = p.billAddress1 || '';
          document.getElementById('profBillAddr2').value = p.billAddress2 || '';
          document.getElementById('profBillCity').value = p.billCity || '';
          document.getElementById('profBillCounty').value = p.billCounty || '';
          document.getElementById('profBillPostcode').value = p.billPostcode || '';
          document.getElementById('profBillCountry').value = p.billCountry || 'GB';
        }
      }

      // Payment (shared) — mask card number in edit mode
      document.getElementById('profCardName').value = p.cardName || '';
      const cardInput = document.getElementById('profCardNumber');
      const revealBtn = document.getElementById('cardRevealBtn');
      if (p.cardNumber && p.cardNumber.length >= 4) {
        realCardNumber = p.cardNumber;
        cardRevealed = false;
        cardInput.value = '•••• •••• •••• ' + p.cardNumber.slice(-4);
        cardInput.readOnly = true;
        revealBtn.style.display = 'block';
        revealBtn.textContent = 'Show';
      } else {
        realCardNumber = '';
        cardRevealed = true;
        cardInput.value = '';
        cardInput.readOnly = false;
        revealBtn.style.display = 'none';
      }
      document.getElementById('profCardType').value = p.cardType || 'visa';
      document.getElementById('profExpiry').value = p.expiryMonth && p.expiryYear ? p.expiryMonth + '/' + (p.expiryYear || '').slice(-2) : '';
      document.getElementById('profCvv').value = p.cvv || '';

      document.querySelector('#profileModal .modal-title').textContent = isLogin ? 'Edit Login Account' : 'Edit Guest Profile';
      document.getElementById('profModalSave').textContent = 'Save Changes';
      profileModal.classList.add('active');
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

const profileModal = document.getElementById('profileModal');

// Mousedown-inside fix for profile modal
profileModal.addEventListener('mousedown', (e) => { profileModal._mouseDownOnOverlay = (e.target === profileModal); });
profileModal.addEventListener('mouseup', (e) => {
  if (e.target === profileModal && profileModal._mouseDownOnOverlay) {
    profileModal.classList.remove('active');
    editingProfileId = null;
  }
  profileModal._mouseDownOnOverlay = false;
});

// existingAccount is now driven by the active profile tab
const profExistingField = document.getElementById('profExisting');

// Card number auto-format (spaces every 4 digits)
document.getElementById('profCardNumber')?.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 16);
  e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
});

// Expiry auto-format (MM/YY)
document.getElementById('profExpiry')?.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '').slice(0, 4);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  e.target.value = v;
});

// Billing toggle
document.getElementById('profBillingSame')?.addEventListener('change', (e) => {
  document.getElementById('profBillingFields').style.display = e.target.checked ? 'none' : 'block';
});

// Card reveal toggle (v1.9.1)
document.getElementById('cardRevealBtn')?.addEventListener('click', () => {
  const cardInput = document.getElementById('profCardNumber');
  const revealBtn = document.getElementById('cardRevealBtn');
  if (cardRevealed) {
    // Re-mask
    cardInput.value = '•••• •••• •••• ' + realCardNumber.slice(-4);
    cardInput.readOnly = true;
    revealBtn.textContent = 'Show';
    cardRevealed = false;
  } else {
    // Reveal
    cardInput.value = realCardNumber.replace(/(.{4})/g, '$1 ').trim();
    cardInput.readOnly = false;
    revealBtn.textContent = 'Hide';
    cardRevealed = true;
  }
});

// Profile site selector logic
function updateProfileFieldsBySite(site) {
  const loginFields = document.getElementById('profLoginFields');
  const guestFields = document.getElementById('profGuestFields');
  const paymentSection = document.querySelector('#profileModal .form-section-divider');
  const paymentFields = [
    document.getElementById('profCardName')?.closest('.form-group'),
    document.getElementById('profCardNumber')?.closest('.form-row'),
    document.getElementById('profExpiry')?.closest('.form-row')
  ];

  if (site === 'very') {
    // Very: Login-style (email, password, postcode) + optional card number
    profExistingField.value = 'true';
    loginFields.style.display = 'block';
    guestFields.style.display = 'none';
  } else {
    // Freemans: Guest-style (full guest checkout fields + payment)
    profExistingField.value = 'false';
    loginFields.style.display = 'none';
    guestFields.style.display = 'block';
  }
}

document.getElementById('profSite')?.addEventListener('change', (e) => {
  updateProfileFieldsBySite(e.target.value);
});

document.getElementById('createProfileBtn').addEventListener('click', () => {
  editingProfileId = null;
  const isLogin = currentProfileTab === 'login';
  // Clear all text/email/password/tel inputs in the modal
  document.querySelectorAll('#profileModal input[type="text"], #profileModal input[type="email"], #profileModal input[type="password"], #profileModal input[type="tel"], #profileModal input[type="number"]').forEach(el => el.value = '');
  // Reset selects
  document.getElementById('profCardType').value = 'visa';
  document.getElementById('profShipCountry').value = 'GB';
  document.getElementById('profBillCountry').value = 'GB';
  // Reset card masking state
  cardRevealed = true;
  realCardNumber = '';
  const cardInput = document.getElementById('profCardNumber');
  if (cardInput) cardInput.readOnly = false;
  const revealBtn = document.getElementById('cardRevealBtn');
  if (revealBtn) revealBtn.style.display = 'none';

  // Set site selector based on current profile tab
  const siteSelect = document.getElementById('profSite');
  if (siteSelect) {
    siteSelect.value = isLogin ? 'very' : 'freemans';
  }
  updateProfileFieldsBySite(isLogin ? 'very' : 'freemans');

  document.getElementById('profBillingSame').checked = true;
  document.getElementById('profBillingFields').style.display = 'none';

  document.querySelector('#profileModal .modal-title').textContent = isLogin ? 'New Login Account' : 'New Guest Profile';
  document.getElementById('profModalSave').textContent = 'Save Profile';
  profileModal.classList.add('active');
  document.getElementById('profName').focus();
});
document.getElementById('profModalCancel').addEventListener('click', () => { profileModal.classList.remove('active'); editingProfileId = null; });

document.getElementById('profModalSave').addEventListener('click', async () => {
  const isExisting = profExistingField.value === 'true';
  // Read card number from correct source (masked vs revealed)
  const rawCardNumber = (!cardRevealed && realCardNumber) ? realCardNumber : document.getElementById('profCardNumber').value.replace(/\s/g, '');
  const profile = {
    id: editingProfileId || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)),
    name: document.getElementById('profName').value.trim() || 'Unnamed',
    site: document.getElementById('profSite')?.value || (isExisting ? 'very' : 'freemans'),
    existingAccount: isExisting,
    // Payment (shared)
    cardName: document.getElementById('profCardName').value.trim(),
    cardNumber: rawCardNumber,
    cardType: document.getElementById('profCardType').value,
    cvv: document.getElementById('profCvv').value.trim(),
    createdAt: editingProfileId ? undefined : Date.now()
  };

  // Parse expiry MM/YY
  const expiry = document.getElementById('profExpiry').value;
  if (expiry && expiry.includes('/')) {
    profile.expiryMonth = expiry.split('/')[0];
    profile.expiryYear = '20' + expiry.split('/')[1];
  } else {
    profile.expiryMonth = '';
    profile.expiryYear = '';
  }

  if (isExisting) {
    // Login profile
    profile.email = document.getElementById('profEmail').value.trim();
    profile.password = document.getElementById('profPassword').value;
    profile.postcode = document.getElementById('profPostcode')?.value?.trim() || '';
    if (!profile.email) { toast('Email is required', 'error'); return; }
    if (!profile.password) { toast('Password is required', 'error'); return; }
  } else {
    // Guest profile — contact
    profile.email = document.getElementById('profGuestEmail').value.trim();
    profile.phone = document.getElementById('profGuestPhone').value.trim();
    // Shipping
    profile.firstName = document.getElementById('profShipFirst').value.trim();
    profile.lastName = document.getElementById('profShipLast').value.trim();
    profile.address1 = document.getElementById('profShipAddr1').value.trim();
    profile.address2 = document.getElementById('profShipAddr2').value.trim();
    profile.city = document.getElementById('profShipCity').value.trim();
    profile.county = document.getElementById('profShipCounty').value.trim();
    profile.postcode = document.getElementById('profShipPostcode').value.trim();
    profile.country = document.getElementById('profShipCountry').value;
    // Billing
    profile.billingSame = document.getElementById('profBillingSame').checked;
    if (!profile.billingSame) {
      profile.billFirstName = document.getElementById('profBillFirst').value.trim();
      profile.billLastName = document.getElementById('profBillLast').value.trim();
      profile.billAddress1 = document.getElementById('profBillAddr1').value.trim();
      profile.billAddress2 = document.getElementById('profBillAddr2').value.trim();
      profile.billCity = document.getElementById('profBillCity').value.trim();
      profile.billCounty = document.getElementById('profBillCounty').value.trim();
      profile.billPostcode = document.getElementById('profBillPostcode').value.trim();
      profile.billCountry = document.getElementById('profBillCountry').value;
    }
    // Backwards compat for checkout engine
    profile.houseNum = profile.address2 || profile.address1;
    profile.title = 'Mr';
    if (!profile.firstName) { toast('First name is required', 'error'); return; }
  }

  await API.saveProfile(profile);
  profileModal.classList.remove('active');
  toast(editingProfileId ? 'Profile updated' : 'Profile created', 'success');
  editingProfileId = null;
  loadProfiles();
});

// ============================================================
// PROFILE SEARCH
// ============================================================
let profileSearchQuery = '';
document.getElementById('profileSearch').addEventListener('input', (e) => {
  profileSearchQuery = e.target.value.toLowerCase().trim();
  loadProfiles();
});

// ============================================================
// PROFILE INFO BANNER (dismissable)
// ============================================================
const profileBanner = document.getElementById('profileInfoBanner');
const closeBannerBtn = document.getElementById('closeProfileBanner');
if (localStorage.getItem('profileBannerDismissed')) {
  profileBanner.style.display = 'none';
}
closeBannerBtn.addEventListener('click', () => {
  profileBanner.style.display = 'none';
  localStorage.setItem('profileBannerDismissed', 'true');
});

// ============================================================
// CSV IMPORT / EXPORT
// ============================================================
const CSV_HEADERS = ['name','firstName','lastName','email','phone','address1','address2','city','county','postcode','country','cardName','cardNumber','cardType','expiryMonth','expiryYear','cvv','password'];

document.getElementById('exportProfilesBtn').addEventListener('click', async () => {
  const allProfiles = await API.getProfiles();
  const profiles = currentProfileTab === 'login'
    ? allProfiles.filter(p => !!p.existingAccount)
    : allProfiles.filter(p => !p.existingAccount);
  if (profiles.length === 0) { toast('No profiles to export', 'info'); return; }

  let csv = CSV_HEADERS.join(',') + '\n';
  profiles.forEach(p => {
    csv += CSV_HEADERS.map(h => {
      let val = (p[h] || '').toString();
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `murph-profiles-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${profiles.length} profiles`, 'success');
});

document.getElementById('importProfilesBtn').addEventListener('click', () => {
  document.getElementById('csvFileInput').click();
});

document.getElementById('csvFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const text = await file.text();
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) { toast('CSV file is empty or invalid', 'error'); return; }

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  let imported = 0;

  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i]);
    const profile = {
      id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + i,
      createdAt: Date.now()
    };
    headers.forEach((h, idx) => {
      if (CSV_HEADERS.includes(h) && vals[idx] !== undefined) {
        profile[h] = vals[idx];
      }
    });
    if (!profile.name) profile.name = (profile.firstName || 'Imported') + ' ' + (profile.lastName || '');
    if (profile.firstName) {
      await API.saveProfile(profile);
      imported++;
    }
  }

  toast(`Imported ${imported} profiles`, 'success');
  loadProfiles();
});

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i+1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

// ============================================================
// SETTINGS
// ============================================================
async function loadSettings() {
  const keyInfo = await API.checkKey();
  const keyText = keyInfo.key || 'None';
  const ownerText = keyInfo.owner ? ` (${keyInfo.owner})` : '';
  document.getElementById('settingsKey').textContent = keyText + ownerText;
  document.getElementById('settingsPlatform').textContent = navigator.platform || 'Unknown';

  // Load user settings
  const s = await API.getSettings();
  document.getElementById('settingDefaultQty').value = s.defaultQuantity || 20;
  document.getElementById('settingTaskDelay').value = s.taskDelay || 300;
  document.getElementById('settingMaxConcurrent').value = s.maxConcurrentTasks || 3;
  document.getElementById('settingMaxRetries').value = s.maxRetries ?? 3;
  document.getElementById('settingRetryDelay').value = s.retryDelay || 5000;
  document.querySelector('#settingAutoClear input').checked = s.autoClearCompleted || false;
  document.querySelector('#settingDebugMode input').checked = s.debugMode || false;
  document.querySelector('#settingNotifSound input').checked = s.notificationSound !== false;
  document.querySelector('#settingDesktopNotif input').checked = s.desktopNotifications !== false;
  document.getElementById('settingWebhookUrl').value = s.webhookUrl || '';

  // Checkout sound dropdown
  const soundSelect = document.getElementById('settingCheckoutSound');
  if (soundSelect) {
    const files = await API.getSoundFiles();
    soundSelect.innerHTML = '<option value="">Default chime</option>' +
      files.map(f => `<option value="${escapeHtml(f)}"${f === s.checkoutSound ? ' selected' : ''}>${escapeHtml(f)}</option>`).join('');
  }

  // Dry run mode
  const dryRunToggle = document.querySelector('#settingDryRun input');
  if (dryRunToggle) dryRunToggle.checked = s.dryRun !== false; // default ON
  // Sync config bar trial toggle with settings
  const trialRunCb = document.getElementById('veryTrialRun');
  if (trialRunCb) trialRunCb.checked = s.dryRun !== false;

  // Proxy enabled toggle is now in setup tab
  const proxyToggle = document.querySelector('#settingProxyEnabled input');
  if (proxyToggle) proxyToggle.checked = s.proxyEnabled || false;

  // Customisation
  document.getElementById('settingUsername').value = s.username || '';
  renderAvatarPicker(s.avatar || 'default');
  renderColourPicker(s.accentColour || 'green');
}

// Auto-save settings on change
function bindSettingsSave() {
  const saveAll = async () => {
    // Preserve avatar/colour set by their own pickers
    const current = await API.getSettings();
    const settings = {
      defaultQuantity: parseInt(document.getElementById('settingDefaultQty').value) || 20,
      taskDelay: parseInt(document.getElementById('settingTaskDelay').value) || 300,
      maxConcurrentTasks: parseInt(document.getElementById('settingMaxConcurrent').value) || 3,
      maxRetries: parseInt(document.getElementById('settingMaxRetries').value) ?? 3,
      retryDelay: parseInt(document.getElementById('settingRetryDelay').value) || 5000,
      autoClearCompleted: document.querySelector('#settingAutoClear input').checked,
      debugMode: document.querySelector('#settingDebugMode input').checked,
      notificationSound: document.querySelector('#settingNotifSound input').checked,
      desktopNotifications: document.querySelector('#settingDesktopNotif input').checked,
      webhookUrl: document.getElementById('settingWebhookUrl').value.trim(),
      checkoutSound: document.getElementById('settingCheckoutSound')?.value || '',
      dryRun: document.querySelector('#settingDryRun input')?.checked ?? true,
      proxyEnabled: document.querySelector('#settingProxyEnabled input').checked,
      defaultProxyGroup: document.getElementById('settingDefaultProxyGroup')?.value || null,
      proxyGroups: current.proxyGroups || [],
      proxies: current.proxies || [],
      proxyRotationIndex: current.proxyRotationIndex || 0,
      avatar: current.avatar || 'default',
      accentColour: current.accentColour || 'green',
      username: document.getElementById('settingUsername').value.trim()
    };
    await API.saveSettings(settings);
    applyCustomisation(settings);
    toast('Settings saved', 'success');
  };

  ['settingDefaultQty','settingTaskDelay','settingMaxConcurrent','settingMaxRetries','settingRetryDelay','settingWebhookUrl','settingUsername','settingDefaultProxyGroup','settingCheckoutSound'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveAll);
  });
  ['#settingAutoClear input','#settingDebugMode input','#settingNotifSound input','#settingDesktopNotif input','#settingProxyEnabled input'].forEach(sel => {
    document.querySelector(sel).addEventListener('change', saveAll);
  });
}
bindSettingsSave();

// Test webhook button
document.getElementById('testWebhookBtn').addEventListener('click', async () => {
  const url = document.getElementById('settingWebhookUrl').value.trim();
  if (!url) { toast('Enter a webhook URL first', 'error'); return; }
  const btn = document.getElementById('testWebhookBtn');
  btn.textContent = '...';
  btn.disabled = true;
  try {
    const res = await API.testWebhook(url);
    if (res.success) {
      toast('Webhook test sent! Check your Discord channel.', 'success');
    } else {
      toast(`Webhook failed: ${res.error || 'HTTP ' + res.status}`, 'error');
    }
  } catch (e) {
    toast('Webhook test failed', 'error');
  }
  btn.textContent = 'Test';
  btn.disabled = false;
});

// Open sounds folder button
document.getElementById('openSoundsFolderBtn')?.addEventListener('click', () => {
  API.openSoundsFolder();
});

// ============================================================
// PROXY GROUPS
// ============================================================
async function renderProxyGroups() {
  const groups = await API.getProxyGroups();
  const container = document.getElementById('proxyGroupsList');
  if (!container) return;

  if (groups.length === 0) {
    container.innerHTML = '<div class="empty-state-mini">No proxy groups. Click <strong>+ Add Group</strong> above.</div>';
    return;
  }

  container.innerHTML = groups.map(g => `
    <div class="proxy-group-card" data-group-id="${g.id}">
      <div class="proxy-group-header">
        <input type="text" class="form-input proxy-group-name" value="${escapeHtml(g.name)}" data-group-id="${g.id}" placeholder="Group name">
        <span class="proxy-group-count">${(g.proxies || []).length} proxies</span>
        <button class="task-action-btn delete" data-action="delete-proxy-group" data-group-id="${g.id}" title="Delete">&times;</button>
      </div>
      <textarea class="form-input proxy-textarea proxy-group-list" data-group-id="${g.id}" rows="3" placeholder="One proxy per line...\nhost:port or user:pass@host:port">${(g.proxies || []).join('\n')}</textarea>
    </div>
  `).join('');

  // Save on change (name or proxy list)
  container.querySelectorAll('.proxy-group-name, .proxy-group-list').forEach(el => {
    el.addEventListener('change', async () => {
      const gId = el.dataset.groupId;
      const groups = await API.getProxyGroups();
      const group = groups.find(g => g.id === gId);
      if (!group) return;
      const card = el.closest('.proxy-group-card');
      group.name = card.querySelector('.proxy-group-name').value.trim() || 'Unnamed';
      group.proxies = card.querySelector('.proxy-group-list').value.split('\n').map(l => l.trim()).filter(Boolean);
      await API.saveProxyGroup(group);
      // Update count badge
      card.querySelector('.proxy-group-count').textContent = group.proxies.length + ' proxies';
      updateDefaultProxyGroupDropdown();
      toast('Proxy group saved', 'success');
    });
  });

  // Delete
  container.querySelectorAll('[data-action="delete-proxy-group"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this proxy group?')) return;
      await API.deleteProxyGroup(btn.dataset.groupId);
      toast('Proxy group deleted', 'info');
      renderProxyGroups();
      updateDefaultProxyGroupDropdown();
    });
  });
}

document.getElementById('addProxyGroupBtn')?.addEventListener('click', async () => {
  const name = prompt('Enter a name for the proxy group:');
  if (!name || !name.trim()) return;
  const group = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    name: name.trim(),
    proxies: [],
    rotationIndex: 0
  };
  await API.saveProxyGroup(group);
  renderProxyGroups();
  updateDefaultProxyGroupDropdown();
  toast('Proxy group created', 'success');
});

async function updateDefaultProxyGroupDropdown() {
  const groups = await API.getProxyGroups();
  const settings = await API.getSettings();
  const sel = document.getElementById('settingDefaultProxyGroup');
  if (!sel) return;
  sel.innerHTML = '<option value="">None</option>' + groups.map(g =>
    `<option value="${g.id}" ${settings.defaultProxyGroup === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
  ).join('');
}

// Test proxy button — tests first proxy from the first group with proxies
document.getElementById('testProxyBtn').addEventListener('click', async () => {
  const groups = await API.getProxyGroups();
  const firstGroup = groups.find(g => g.proxies && g.proxies.length > 0);
  if (!firstGroup) { toast('Add at least one proxy to a group', 'error'); return; }
  const btn = document.getElementById('testProxyBtn');
  const result = document.getElementById('proxyTestResult');
  btn.textContent = 'Testing...';
  btn.disabled = true;
  result.textContent = '';
  result.style.color = 'var(--text-muted)';
  try {
    const res = await API.testProxy(firstGroup.proxies[0]);
    if (res.success) {
      result.textContent = `Your IP: ${res.ip}`;
      result.style.color = 'var(--primary)';
      toast('Proxy test passed!', 'success');
    } else {
      result.textContent = res.error || 'Failed';
      result.style.color = 'var(--error)';
      toast(`Proxy test failed: ${res.error}`, 'error');
    }
  } catch (e) {
    result.textContent = 'Connection failed';
    result.style.color = 'var(--error)';
    toast('Proxy test failed', 'error');
  }
  btn.textContent = 'Test Proxy';
  btn.disabled = false;
});

document.getElementById('settingsDeactivate').addEventListener('click', async () => {
  const yes = await showConfirm('Deactivate your license key? You will need to re-enter it.', 'Deactivate');
  if (yes) { await API.deactivateKey(); }
});

document.getElementById('settingsClearSessions').addEventListener('click', async () => {
  const yes = await showConfirm('Clear all saved sessions? You will need to re-login on next task.', 'Clear');
  if (yes) {
    await API.clearCookies();
    toast('Sessions cleared', 'success');
  }
});

document.getElementById('settingsResetStats').addEventListener('click', async () => {
  const yes = await showConfirm('Reset all statistics to zero?', 'Reset');
  if (yes) { await API.updateStats({ tasksRun: 0, itemsAdded: 0, checkouts: 0 }); toast('Stats reset', 'success'); loadDashboard(); }
});

// ============================================================
// MODAL UTILITIES
// ============================================================
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  // Skip overlays that have their own mousedown-inside handlers (task modal, profile modal)
  if (overlay.id === 'taskModalOverlay' || overlay.id === 'profileModal') return;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.classList.remove('active'); editingProfileId = null; } });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close task modal if open
    const taskModal = document.getElementById('taskModalOverlay');
    if (taskModal && taskModal.classList.contains('active')) { closeTaskModal(); return; }
    document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    editingProfileId = null;
    if (confirmResolve) { confirmOverlay.classList.remove('active'); confirmResolve(false); confirmResolve = null; }
    // Close startup update popup if open
    const startupPopup = document.getElementById('startupUpdateOverlay');
    if (startupPopup && startupPopup.classList.contains('active')) startupPopup.classList.remove('active');
  }
});

// ============================================================
// SCHEDULER — Check for scheduled tasks every 30s
// ============================================================
function shouldRunNow(schedule, now) {
  const [hh, mm] = (schedule.time || '00:00').split(':').map(Number);
  const schedMinutes = hh * 60 + mm;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if already ran today
  if (schedule.lastRun) {
    const lastRun = new Date(schedule.lastRun);
    const sameDay = lastRun.getFullYear() === now.getFullYear() &&
      lastRun.getMonth() === now.getMonth() &&
      lastRun.getDate() === now.getDate();
    if (sameDay) return false;
  }

  if (schedule.type === 'once') {
    if (!schedule.date) return false;
    const [y, m, d] = schedule.date.split('-').map(Number);
    const schedDate = new Date(y, m - 1, d, hh, mm);
    return now >= schedDate;
  }

  if (schedule.type === 'daily') {
    return nowMinutes >= schedMinutes;
  }

  if (schedule.type === 'weekly') {
    const days = schedule.days || [];
    if (!days.includes(now.getDay())) return false;
    return nowMinutes >= schedMinutes;
  }

  return false;
}

setInterval(async () => {
  try {
    const tasks = await API.getTasks();
    const now = new Date();
    let queued = 0;
    for (const task of tasks) {
      if (!task.schedule?.enabled || task.status !== 'idle') continue;
      if (shouldRunNow(task.schedule, now)) {
        task.schedule.lastRun = now.toISOString();
        if (task.schedule.type === 'once') task.schedule.enabled = false;
        await API.saveTask(task);
        if (!taskQueue.includes(task.id)) {
          taskQueue.push(task.id);
          queued++;
        }
      }
    }
    if (queued > 0) {
      toast(`Scheduler triggered ${queued} task${queued > 1 ? 's' : ''}`, 'info');
      processQueue();
    }
  } catch (e) { /* scheduler should never crash the app */ }
}, 30000);

// Task groups removed in v2.0

// ============================================================
// STOCK MONITOR — Polling (v1.9.2 — modal handlers moved to side panel)
// ============================================================

// Stock monitor polling — check every 10s, only poll monitors whose interval has elapsed
setInterval(async () => {
  try {
    const monitors = await API.getStockMonitors();
    const now = Date.now();
    for (const m of monitors) {
      if (!m.enabled) continue;
      const elapsed = now - (m.lastChecked || 0);
      if (elapsed < (m.checkInterval || 30000)) continue;

      m.lastChecked = now;
      const result = await API.checkStock({ url: m.productUrl });
      m.lastStatus = result.inStock ? 'in_stock' : 'out_of_stock';

      if (result.inStock && !m.notified) {
        m.notified = true;
        const settings = await API.getSettings();
        if (settings.desktopNotifications) {
          API.showNotification({ title: 'Stock Alert!', body: `${m.productName} is back in stock!` });
        }
        toast(`Stock alert: ${m.productName} is in stock!`, 'success');
        // Discord webhook
        if (settings.webhookUrl) {
          sendWebhook(settings.webhookUrl, {
            embeds: [{
              title: 'Stock Alert!',
              description: `**${m.productName}** is back in stock!`,
              color: 0x00b894,
              fields: [{ name: 'Product', value: m.productUrl, inline: false }],
              footer: { text: 'Murph AIO \u2022 Stock Monitor' },
              timestamp: new Date().toISOString()
            }]
          });
        }
        // Auto-run
        if (m.autoRun) {
          const task = {
            id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
            url: m.productUrl, quantity: m.quantity || 20,
            profileId: m.profileId || '', deliveryMethod: m.deliveryMethod || 'standard',
            module: m.module || 'freemans',
            status: 'idle', productCode: result.productCode || null, createdAt: Date.now()
          };
          await API.saveTask(task);
          taskQueue.push(task.id);
          processQueue();
          toast(`Stock found! Task created for ${m.productName}`, 'success');
        }
      } else if (!result.inStock) {
        m.notified = false;
      }

      await API.saveStockMonitor(m);
    }
    // Refresh UI if on tasks page (monitors now live in tasks)
    const tasksPage = document.getElementById('page-tasks');
    if (tasksPage && tasksPage.classList.contains('active')) {
      try { loadTasks(); } catch (e) {}
    }
  } catch (e) { /* stock monitor should never crash the app */ }
}, 10000);

// ============================================================
// EXTENSION PAGE
// ============================================================

async function loadExtensionPage() {
  // Load extension path
  try {
    const extPath = await window.murphAPI.getExtensionPath();
    const el = document.getElementById('extPath');
    if (el) el.textContent = extPath || 'Extension not found — restart app';
  } catch (e) {
    const el = document.getElementById('extPath');
    if (el) el.textContent = 'Error loading path';
  }

  // Update connection status
  try {
    const status = await window.murphAPI.getExtensionStatus();
    const dot = document.getElementById('extStatusDot');
    const text = document.getElementById('extStatusText');
    if (status && status.connected) {
      if (dot) dot.style.background = '#22c55e';
      if (text) text.textContent = 'Connected — extension is communicating with the app.';
    } else {
      if (dot) dot.style.background = '#f97316';
      if (text) text.textContent = 'Not connected — open Chrome with the extension to connect.';
    }
  } catch (e) {
    const dot = document.getElementById('extStatusDot');
    const text = document.getElementById('extStatusText');
    if (dot) dot.style.background = '#666';
    if (text) text.textContent = 'Unable to check status.';
  }
}

// Open Chrome with extension
document.getElementById('extOpenChrome')?.addEventListener('click', async () => {
  const btn = document.getElementById('extOpenChrome');
  const origText = btn.textContent;
  btn.textContent = 'Opening...';
  btn.disabled = true;
  try {
    const result = await window.murphAPI.openChromeWithExtension();
    if (result && !result.success) {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
      console.error('[Extension] Open Chrome failed:', result.error);
    } else {
      btn.textContent = 'Opened!';
      setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 2000);
    }
  } catch (e) {
    btn.textContent = origText;
    btn.disabled = false;
  }
});

// Copy extension path
document.getElementById('extCopyPath')?.addEventListener('click', async () => {
  const path = document.getElementById('extPath')?.textContent;
  if (path && path !== 'Loading...' && path !== 'Extension not found — restart app') {
    try {
      await navigator.clipboard.writeText(path);
      const btn = document.getElementById('extCopyPath');
      const origText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = origText; }, 1500);
    } catch (e) {
      console.error('[Extension] Copy failed:', e);
    }
  }
});

// Open extension folder in Finder/Explorer
document.getElementById('extOpenFolder')?.addEventListener('click', async () => {
  const btn = document.getElementById('extOpenFolder');
  const origText = btn.textContent;
  btn.textContent = 'Opening...';
  btn.disabled = true;
  try {
    await window.murphAPI.openExtensionFolder();
    btn.textContent = 'Opened!';
    setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 1500);
  } catch (e) {
    btn.textContent = origText;
    btn.disabled = false;
  }
});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-overlay.active') || document.querySelector('.confirm-overlay.active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '1') navigateTo('dashboard');
  if (e.key === '2') navigateTo('tasks');
  if (e.key === '3') navigateTo('setup');
  if (e.key === '4') navigateTo('extension');
  if (e.key === '5') navigateTo('settings');
});

// ============================================================
// CONTEXT MENUS (v1.9.1)
// ============================================================
function showContextMenu(e, items) {
  e.preventDefault();
  const menu = document.getElementById('contextMenu');
  if (!menu) return;
  menu.innerHTML = items.map(item => {
    if (item.divider) return '<div class="context-menu-divider"></div>';
    return `<button class="context-menu-item ${item.danger ? 'danger' : ''}" data-action="${item.action}">${item.icon ? item.icon + ' ' : ''}${item.label}</button>`;
  }).join('');
  menu.style.display = 'block';
  // Position
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - (items.length * 36 + 8));
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  // Bind actions
  menu.querySelectorAll('.context-menu-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const handler = items.find(i => i.action === action);
      if (handler && handler.handler) handler.handler();
      hideContextMenu();
    });
  });
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.style.display = 'none';
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });

// Bind context menus on profile cards (delegated via mutation observer pattern — re-bind after loadProfiles)
const _originalLoadProfiles = loadProfiles;
loadProfiles = async function() {
  await _originalLoadProfiles();
  // Bind contextmenu on profile cards
  document.querySelectorAll('.profile-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      const id = card.dataset.id;
      showContextMenu(e, [
        { label: 'Edit', icon: '✏️', action: 'edit', handler: () => card.querySelector('[data-action="edit-profile"]')?.click() },
        { label: 'Duplicate', icon: '⧉', action: 'duplicate', handler: () => card.querySelector('[data-action="duplicate-profile"]')?.click() },
        { label: 'Copy Email', icon: '📋', action: 'copy-email', handler: async () => {
          const profiles = await API.getProfiles();
          const p = profiles.find(x => x.id === id);
          if (p?.email) { navigator.clipboard.writeText(p.email); toast('Email copied', 'success'); }
          else toast('No email to copy', 'info');
        }},
        { divider: true },
        { label: 'Delete', icon: '🗑', action: 'delete', danger: true, handler: () => card.querySelector('[data-action="delete-profile"]')?.click() }
      ]);
    });
  });
};

// ============================================================
// BULK ACTIONS (v2.0 — integrated into loadTasks)
// ============================================================
const selectedTasks = new Set();

function updateBulkBar() {
  const bar = document.getElementById('bulkActionsBar');
  const countEl = document.getElementById('bulkCount');
  const tasksPage = document.getElementById('page-tasks');
  if (!bar || !countEl) return;
  // Only show on tasks page
  if (!tasksPage || !tasksPage.classList.contains('active')) {
    bar.classList.remove('visible');
    return;
  }
  if (selectedTasks.size > 0) {
    bar.classList.add('visible');
    countEl.textContent = `${selectedTasks.size} selected`;
  } else {
    bar.classList.remove('visible');
  }
}

// Context menus + bulk actions are now directly in loadTasks
// Bind context menus after each render
const _originalLoadTasks = loadTasks;
loadTasks = async function() {
  await _originalLoadTasks();
  // Bind contextmenu on task cards (checkout tasks)
  document.querySelectorAll('.task-card:not(.monitor-variant)').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      const isRunning = card.querySelector('[data-action="stop"]');
      showContextMenu(e, [
        { label: 'Edit', icon: '✎', action: 'edit', handler: () => card.querySelector('[data-action="edit"]')?.click() },
        isRunning
          ? { label: 'Stop', icon: '⏹', action: 'stop', handler: () => card.querySelector('[data-action="stop"]')?.click() }
          : { label: 'Run', icon: '▶️', action: 'run', handler: () => card.querySelector('[data-action="run"]')?.click() },
        { label: 'Duplicate', icon: '⧉', action: 'duplicate', handler: () => card.querySelector('[data-action="duplicate"]')?.click() },
        { divider: true },
        { label: 'Delete', icon: '🗑', action: 'delete', danger: true, handler: () => card.querySelector('[data-action="delete"]')?.click() }
      ]);
    });
  });
  // Bind contextmenu on monitor cards
  document.querySelectorAll('.task-card.monitor-variant').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      showContextMenu(e, [
        { label: 'Edit', icon: '✎', action: 'edit-monitor', handler: () => card.querySelector('[data-action="edit-monitor"]')?.click() },
        { label: 'Check Now', icon: '🔍', action: 'check-now', handler: () => card.querySelector('[data-action="check-now"]')?.click() },
        { divider: true },
        { label: 'Delete', icon: '🗑', action: 'delete', danger: true, handler: () => card.querySelector('[data-action="delete-monitor"]')?.click() }
      ]);
    });
  });
  // Update bulk actions state
  updateBulkBar();
};

// Select All toggle
document.getElementById('bulkSelectAll')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.task-select-checkbox').forEach(cb => {
    cb.checked = checked;
    const card = cb.closest('.task-card');
    if (card?.dataset?.id) {
      if (checked) selectedTasks.add(card.dataset.id);
      else selectedTasks.delete(card.dataset.id);
    }
  });
  updateBulkBar();
});

// Bulk Start
document.getElementById('bulkStartBtn')?.addEventListener('click', async () => {
  if (selectedTasks.size === 0) return;
  const tasks = await API.getTasks();
  let queued = 0;
  for (const id of selectedTasks) {
    const task = tasks.find(t => t.id === id);
    if (task && (task.status === 'idle' || task.status === 'error')) {
      if (!taskQueue.includes(id)) {
        taskQueue.push(id);
        queued++;
      }
    }
  }
  if (queued > 0) {
    toast(`Queued ${queued} task${queued !== 1 ? 's' : ''}`, 'info');
    processQueue();
  }
  selectedTasks.clear();
  document.getElementById('bulkSelectAll').checked = false;
  updateBulkBar();
  loadTasks();
});

// Bulk Stop
document.getElementById('bulkStopBtn')?.addEventListener('click', async () => {
  if (selectedTasks.size === 0) return;
  const tasks = await API.getTasks();
  let stopped = 0;
  for (const id of selectedTasks) {
    const task = tasks.find(t => t.id === id);
    if (task && task.status === 'running') {
      task.status = 'error';
      task.error = 'Stopped by user';
      task.completedAt = Date.now();
      await API.saveTask(task);
      runningTasks.delete(id);
      stopped++;
    }
    // Remove from queue
    const qIdx = taskQueue.indexOf(id);
    if (qIdx !== -1) taskQueue.splice(qIdx, 1);
  }
  if (stopped > 0) toast(`Stopped ${stopped} task${stopped !== 1 ? 's' : ''}`, 'info');
  selectedTasks.clear();
  document.getElementById('bulkSelectAll').checked = false;
  updateBulkBar();
  loadTasks();
  loadDashboard();
});

// Bulk Delete
document.getElementById('bulkDeleteBtn')?.addEventListener('click', async () => {
  if (selectedTasks.size === 0) return;
  const yes = await showConfirm(`Delete ${selectedTasks.size} selected task${selectedTasks.size !== 1 ? 's' : ''}?`, 'Delete');
  if (!yes) return;
  for (const id of selectedTasks) {
    await API.deleteTask(id);
  }
  toast(`Deleted ${selectedTasks.size} tasks`, 'info');
  selectedTasks.clear();
  document.getElementById('bulkSelectAll').checked = false;
  updateBulkBar();
  loadTasks();
});

// ============================================================
// SETTINGS EXPORT / IMPORT (v1.9.1)
// ============================================================
document.getElementById('settingsExportData')?.addEventListener('click', async () => {
  try {
    const data = await API.exportAllData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `murph-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const counts = [
      data.profiles?.length ? `${data.profiles.length} profiles` : null,
      data.tasks?.length ? `${data.tasks.length} tasks` : null,
      data.stockMonitors?.length ? `${data.stockMonitors.length} monitors` : null,
      data.taskGroups?.length ? `${data.taskGroups.length} groups` : null
    ].filter(Boolean).join(', ');
    toast(`Exported: ${counts || 'settings'}`, 'success');
  } catch (e) {
    toast('Export failed: ' + e.message, 'error');
  }
});

document.getElementById('settingsImportData')?.addEventListener('click', () => {
  document.getElementById('importDataFileInput').click();
});

document.getElementById('importDataFileInput')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    // Validate structure
    if (!data.version && !data.settings && !data.profiles) {
      toast('Invalid backup file', 'error');
      return;
    }
    // Build summary
    const items = [
      data.profiles?.length ? `${data.profiles.length} profiles` : null,
      data.tasks?.length ? `${data.tasks.length} tasks` : null,
      data.stockMonitors?.length ? `${data.stockMonitors.length} monitors` : null,
      data.taskGroups?.length ? `${data.taskGroups.length} groups` : null,
      data.settings ? 'settings' : null
    ].filter(Boolean).join(', ');
    const yes = await showConfirm(`Import backup? This will replace: ${items}`, 'Import');
    if (!yes) return;
    const result = await API.importAllData(data);
    if (result.success) {
      toast('Data imported successfully! Reloading...', 'success');
      // Reload all pages
      const settings = await API.getSettings();
      applyCustomisation(settings);
      loadDashboard();
      loadTasks();
      loadProfiles();
      loadSettings();
    } else {
      toast('Import failed: ' + (result.error || 'Unknown error'), 'error');
    }
  } catch (err) {
    toast('Invalid JSON file: ' + err.message, 'error');
  }
});

// ============================================================
// AUTO-UPDATER UI
// ============================================================
let updateState = 'idle'; // idle | available | downloading | ready

API.onUpdateAvailable?.((data) => {
  updateState = 'available';
  const banner = document.getElementById('updateBanner');
  const text = document.getElementById('updateBannerText');
  const btn = document.getElementById('updateActionBtn');
  if (banner) {
    text.textContent = `Update v${data.version} is available!`;
    btn.textContent = 'Download';
    banner.style.display = 'flex';
  }
});

API.onUpdateProgress?.((data) => {
  const text = document.getElementById('updateBannerText');
  if (text) text.textContent = `Downloading update... ${data.percent}%`;
});

API.onUpdateDownloaded?.(() => {
  updateState = 'ready';
  const text = document.getElementById('updateBannerText');
  const btn = document.getElementById('updateActionBtn');
  if (text) text.textContent = 'Update downloaded! Restart to apply.';
  if (btn) btn.textContent = 'Restart';
});

document.getElementById('updateActionBtn')?.addEventListener('click', async () => {
  if (updateState === 'available') {
    updateState = 'downloading';
    const btn = document.getElementById('updateActionBtn');
    if (btn) { btn.textContent = '...'; btn.disabled = true; }
    await API.updaterDownload();
  } else if (updateState === 'ready') {
    await API.updaterInstall();
  }
});

document.getElementById('updateBannerClose')?.addEventListener('click', () => {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.style.display = 'none';
});

// ============================================================
// STARTUP UPDATE CHECK POPUP
// ============================================================
const startupOverlay = document.getElementById('startupUpdateOverlay');
const startupContent = document.getElementById('startupUpdateContent');

API.onUpdateChecking?.(() => {
  if (startupOverlay) startupOverlay.classList.add('active');
});

API.onUpdateCheckResult?.((data) => {
  if (!startupOverlay || !startupContent) return;
  if (data.update) {
    // Update available — show version + download button
    startupContent.innerHTML = `
      <div style="text-align:center;">
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px;">Update Available!</div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Version ${data.version} is ready to download.</div>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button class="btn btn-ghost" id="startupUpdateDismiss">Later</button>
          <button class="btn btn-primary" id="startupUpdateDownload">Download</button>
        </div>
      </div>`;
    document.getElementById('startupUpdateDismiss')?.addEventListener('click', () => {
      startupOverlay.classList.remove('active');
    });
    document.getElementById('startupUpdateDownload')?.addEventListener('click', async () => {
      // Close popup, show banner, trigger download
      startupOverlay.classList.remove('active');
      const banner = document.getElementById('updateBanner');
      const text = document.getElementById('updateBannerText');
      const btn = document.getElementById('updateActionBtn');
      if (banner) {
        text.textContent = 'Downloading update...';
        btn.textContent = '...';
        btn.disabled = true;
        banner.style.display = 'flex';
      }
      updateState = 'downloading';
      await API.updaterDownload();
    });
  } else {
    // No update — show tick and auto-close
    startupContent.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;justify-content:center;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>
        <span style="font-size:14px;font-weight:600;color:var(--text);">You're up to date!</span>
      </div>`;
    setTimeout(() => { startupOverlay.classList.remove('active'); }, 2000);
  }
});

// Manual "Check for Updates" button in Settings
let _updateState = 'idle'; // idle | checking | download | downloading | ready | installing
document.getElementById('checkUpdateBtn')?.addEventListener('click', async () => {
  const btn = document.getElementById('checkUpdateBtn');
  const statusText = document.getElementById('updateStatusText');

  if (_updateState === 'download') {
    // Download the update
    _updateState = 'downloading';
    btn.disabled = true;
    btn.textContent = 'Downloading...';
    statusText.textContent = 'Downloading update — this may take a minute...';
    await API.updaterDownload();
    return;
  }

  if (_updateState === 'ready') {
    // Install the update
    _updateState = 'installing';
    btn.disabled = true;
    btn.textContent = 'Installing...';
    statusText.textContent = 'Installing update — app will restart...';
    await API.updaterInstall();
    return;
  }

  // Check for updates
  _updateState = 'checking';
  btn.disabled = true;
  btn.textContent = 'Checking...';
  statusText.textContent = 'Checking for updates...';

  try {
    const result = await API.updaterCheck();
    if (result.update) {
      _updateState = 'download';
      statusText.textContent = `Update v${result.version} available!`;
      btn.textContent = 'Download';
      btn.disabled = false;
    } else if (result.error) {
      _updateState = 'idle';
      statusText.textContent = `Update failed: ${result.error}`;
      btn.textContent = 'Retry';
      btn.disabled = false;
    } else {
      statusText.textContent = 'You\'re on the latest version!';
      btn.textContent = 'Up to date';
      setTimeout(() => {
        _updateState = 'idle';
        btn.textContent = 'Check for Updates';
        btn.disabled = false;
        statusText.textContent = 'Check for new versions of Murph AIO.';
      }, 3000);
    }
  } catch (e) {
    _updateState = 'idle';
    statusText.textContent = 'Update check failed.';
    btn.textContent = 'Check for Updates';
    btn.disabled = false;
  }
});

// When update is downloaded via manual flow, update the settings button too
API.onUpdateDownloaded?.(() => {
  _updateState = 'ready';
  const btn = document.getElementById('checkUpdateBtn');
  const statusText = document.getElementById('updateStatusText');
  if (btn) {
    btn.textContent = 'Restart & Update';
    btn.disabled = false;
  }
  if (statusText) statusText.textContent = 'Update ready! Click to restart and apply.';
});

// Set version in settings dynamically
(async () => {
  try {
    const ver = await API.getAppVersion();
    const el = document.querySelector('#page-settings .settings-row-desc[id="settingsPlatform"]');
    const verDesc = document.querySelector('#page-settings .settings-card-body');
    // Find the version row and update it
    document.querySelectorAll('.settings-row-desc').forEach(d => {
      if (d.textContent.includes('Murph AIO v')) d.textContent = `Murph AIO v${ver}`;
    });
  } catch (e) { /* not critical */ }
})();

// ============================================================
// VERY WORKSPACE — Cart Links, Drag & Drop, Progress
// ============================================================
const veryTaskItems = []; // { id, linkId, name, url, qty, status, progress, stepLabel, error }
let veryRunning = false;
let veryTimerInterval = null;
let veryTimerStart = 0;
let veryCompletedCount = 0;

// Load saved cart links (compact pill display)
// ---- Cart Link Groups ----
let veryLinkGroups = [];
let activeVeryGroupId = null;

async function initVeryLinkGroups() {
  veryLinkGroups = await API.getVeryLinkGroups();
  if (veryLinkGroups.length === 0) {
    // Create single default group on first load
    const group = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2), name: 'Group 1', order: 0 };
    await API.saveVeryLinkGroup(group);
    veryLinkGroups = await API.getVeryLinkGroups();
  }
  activeVeryGroupId = veryLinkGroups[0]?.id || null;
  renderVeryGroupTabs();
  loadVeryLinks();
}

function renderVeryGroupTabs() {
  const strip = document.getElementById('veryGroupStrip');
  if (!strip) return;
  const scrollArea = document.getElementById('veryGroupScrollArea');
  if (!scrollArea) return;

  // Clear scroll area tabs
  scrollArea.innerHTML = '';

  // Render tabs inside scroll area
  veryLinkGroups.forEach(group => {
    const tab = document.createElement('button');
    tab.className = 'very-link-group-tab' + (group.id === activeVeryGroupId ? ' active' : '');
    tab.dataset.groupId = group.id;
    tab.innerHTML = `<span class="very-link-group-tab-name">${escapeHtml(group.name)}</span>`;

    // Click to select
    tab.addEventListener('click', () => {
      activeVeryGroupId = group.id;
      renderVeryGroupTabs();
      loadVeryLinks();
    });

    scrollArea.appendChild(tab);
  });

  // Update scroll arrow visibility
  updateGroupScrollArrows();
}

function updateGroupScrollArrows() {
  const area = document.getElementById('veryGroupScrollArea');
  const leftArr = document.getElementById('veryGroupScrollLeft');
  const rightArr = document.getElementById('veryGroupScrollRight');
  if (!area || !leftArr || !rightArr) return;
  leftArr.style.display = area.scrollLeft > 0 ? 'flex' : 'none';
  rightArr.style.display = area.scrollLeft < (area.scrollWidth - area.clientWidth - 2) ? 'flex' : 'none';
}

// Scroll arrows
document.getElementById('veryGroupScrollLeft')?.addEventListener('click', () => {
  const area = document.getElementById('veryGroupScrollArea');
  if (area) { area.scrollBy({ left: -120, behavior: 'smooth' }); setTimeout(updateGroupScrollArrows, 300); }
});
document.getElementById('veryGroupScrollRight')?.addEventListener('click', () => {
  const area = document.getElementById('veryGroupScrollArea');
  if (area) { area.scrollBy({ left: 120, behavior: 'smooth' }); setTimeout(updateGroupScrollArrows, 300); }
});

// Settings cog for active group — opens context menu
document.getElementById('veryGroupSettingsBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('veryGroupMenu');
  if (!menu) return;
  menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
});

// Close menu on click outside
document.addEventListener('click', () => {
  const menu = document.getElementById('veryGroupMenu');
  if (menu) menu.style.display = 'none';
});

// Rename group action
document.getElementById('veryGroupRenameBtn')?.addEventListener('click', () => {
  document.getElementById('veryGroupMenu').style.display = 'none';
  const group = veryLinkGroups.find(g => g.id === activeVeryGroupId);
  if (!group) return;
  const tab = document.querySelector(`.very-link-group-tab[data-group-id="${activeVeryGroupId}"]`);
  if (!tab) return;
  const nameSpan = tab.querySelector('.very-link-group-tab-name');
  const input = document.createElement('input');
  input.className = 'very-link-group-tab-input';
  input.value = group.name;
  input.maxLength = 30;
  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newName = input.value.trim() || group.name;
    group.name = newName;
    await API.saveVeryLinkGroup(group);
    veryLinkGroups = await API.getVeryLinkGroups();
    renderVeryGroupTabs();
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') input.blur();
    if (ke.key === 'Escape') { input.value = group.name; input.blur(); }
  });
});

// Delete group action
document.getElementById('veryGroupDeleteBtn')?.addEventListener('click', async () => {
  document.getElementById('veryGroupMenu').style.display = 'none';
  if (veryLinkGroups.length <= 1) { toast('Need at least one group', 'error'); return; }
  const group = veryLinkGroups.find(g => g.id === activeVeryGroupId);
  if (!group) return;
  await API.deleteVeryLinkGroup(group.id);
  veryLinkGroups = await API.getVeryLinkGroups();
  activeVeryGroupId = veryLinkGroups[0]?.id || null;
  renderVeryGroupTabs();
  loadVeryLinks();
  toast(`"${group.name}" deleted`, 'info');
});

// Add new group
document.getElementById('veryGroupAddBtn')?.addEventListener('click', async () => {
  const name = 'Group ' + (veryLinkGroups.length + 1);
  const group = { id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2), name, order: veryLinkGroups.length };
  await API.saveVeryLinkGroup(group);
  veryLinkGroups = await API.getVeryLinkGroups();
  activeVeryGroupId = group.id;
  renderVeryGroupTabs();
  loadVeryLinks();
  toast('Group created', 'success');
});

async function loadVeryLinks() {
  const allLinks = await API.getVeryLinks();
  const links = activeVeryGroupId ? allLinks.filter(l => l.groupId === activeVeryGroupId) : allLinks;
  const list = document.getElementById('veryLinkList');
  const empty = document.getElementById('veryLinkEmpty');
  const count = document.getElementById('veryLinkCount');
  if (!list) return;

  count.textContent = links.length;

  if (links.length === 0) {
    list.innerHTML = '';
    if (empty) {
      empty.style.display = 'flex';
      list.appendChild(empty);
    }
    return;
  }

  if (empty) empty.style.display = 'none';

  list.innerHTML = links.map(link => `
    <div class="very-link-pill" draggable="true" data-link-id="${link.id}" data-link-name="${escapeHtml(link.name)}" data-link-url="${escapeHtml(link.url)}">
      <span class="very-link-pill-label">${escapeHtml(link.name)}</span>
      <button class="very-link-pill-delete" data-action="delete-link" data-link-id="${link.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `).join('');

  // Bind drag events
  list.querySelectorAll('.very-link-pill').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      card.classList.add('dragging');
      e.dataTransfer.setData('application/very-link', JSON.stringify({
        id: card.dataset.linkId,
        name: card.dataset.linkName,
        url: card.dataset.linkUrl
      }));
      e.dataTransfer.effectAllowed = 'copy';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  // Bind delete buttons
  list.querySelectorAll('[data-action="delete-link"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const linkId = btn.dataset.linkId;
      await API.deleteVeryLink(linkId);
      toast('Link deleted', 'info');
      loadVeryLinks();
    });
  });
}

// Add new cart link (to active group)
document.getElementById('veryLinkAddBtn')?.addEventListener('click', async () => {
  const nameInput = document.getElementById('veryLinkName');
  const urlInput = document.getElementById('veryLinkUrl');
  const name = nameInput.value.trim();
  const url = urlInput.value.trim();

  if (!name) { toast('Enter a name for this link', 'error'); nameInput.focus(); return; }
  if (!url) { toast('Paste a cart link URL', 'error'); urlInput.focus(); return; }

  const link = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    name,
    url,
    groupId: activeVeryGroupId,
    createdAt: Date.now()
  };
  await API.saveVeryLink(link);
  nameInput.value = '';
  urlInput.value = '';
  toast(`Cart link "${name}" saved`, 'success');
  loadVeryLinks();
});

// Drop zone events
const veryDropZone = document.getElementById('veryDropZone');
if (veryDropZone) {
  veryDropZone.addEventListener('dragover', (e) => {
    // Only handle link drags (from pills), not task reorder drags
    if (e.dataTransfer.types.includes('text/very-reorder')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    veryDropZone.classList.add('drag-over');
  });
  veryDropZone.addEventListener('dragleave', (e) => {
    if (!veryDropZone.contains(e.relatedTarget)) {
      veryDropZone.classList.remove('drag-over');
    }
  });
  veryDropZone.addEventListener('drop', (e) => {
    // Only handle link drops, not task reorder drops
    if (e.dataTransfer.types.includes('text/very-reorder')) return;
    e.preventDefault();
    veryDropZone.classList.remove('drag-over');
    const data = e.dataTransfer.getData('application/very-link');
    if (!data) return;
    try {
      const link = JSON.parse(data);
      addVeryTaskItem(link);
    } catch (err) { /* invalid data */ }
  });
}

function addVeryTaskItem(link) {
  // Check if already added
  const existing = veryTaskItems.find(t => t.linkId === link.id);
  if (existing) {
    toast('This link is already in the task list', 'info');
    return;
  }
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    linkId: link.id,
    name: link.name,
    url: link.url,
    status: 'idle',
    progress: 0,
    stepLabel: '',
    error: null
  };
  veryTaskItems.push(item);
  renderVeryTaskList();
  updateVeryStartBtn();
}

function removeVeryTaskItem(itemId) {
  const idx = veryTaskItems.findIndex(t => t.id === itemId);
  if (idx !== -1) veryTaskItems.splice(idx, 1);
  renderVeryTaskList();
  updateVeryStartBtn();
}

function renderVeryTaskList() {
  const list = document.getElementById('veryTaskList');
  const empty = document.getElementById('veryDropEmpty');
  const header = document.getElementById('veryDropHeader');
  const countEl = document.getElementById('veryTaskCount');
  if (!list) return;

  if (veryTaskItems.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    if (header) header.style.display = 'none';
    document.getElementById('veryDropZone')?.classList.remove('has-tasks');
    return;
  }

  if (empty) empty.style.display = 'none';
  if (header) header.style.display = 'flex';
  if (countEl) countEl.textContent = `${veryTaskItems.length} item${veryTaskItems.length !== 1 ? 's' : ''}`;
  document.getElementById('veryDropZone')?.classList.add('has-tasks');

  list.innerHTML = veryTaskItems.map((item, idx) => {
    const statusClass = item.status === 'running' ? 'is-running' : item.status === 'done' ? 'is-done' : item.status === 'error' ? 'is-error' : item.status === 'oos' ? 'is-oos' : item.status === 'dry-run' ? 'is-dry-run' : item.status === '3ds' ? 'is-3ds' : '';
    const statusText = item.status === 'running' ? (item.stepLabel || 'Starting...') : item.status === 'done' ? 'Completed' : item.status === 'oos' ? 'Out of Stock' : item.status === 'error' ? (item.error || 'Failed') : item.status === 'dry-run' ? 'Dry Run Complete' : item.status === '3ds' ? 'Awaiting 3DS...' : '';
    const statusTextClass = item.status !== 'idle' ? item.status : '';
    const isDisabled = veryRunning ? 'disabled' : '';
    return `
      <div class="very-task-item ${statusClass}" data-item-id="${item.id}" data-index="${idx}" draggable="${!veryRunning}">
        <span class="very-task-item-drag"><svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg></span>
        <div class="very-task-item-info">
          <div class="very-task-item-name">${escapeHtml(item.name)}</div>
          ${statusText ? `<div class="very-task-item-status ${statusTextClass}">${escapeHtml(statusText)}</div>` : ''}
        </div>
        <button class="very-task-item-remove" data-item-id="${item.id}" title="Remove" ${isDisabled ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        <div class="very-task-item-progress">
          <div class="very-task-item-progress-bar" id="very-progress-${item.id}" style="width:${item.progress}%"></div>
        </div>
      </div>
    `;
  }).join('');

  // Bind remove
  list.querySelectorAll('.very-task-item-remove').forEach(btn => {
    btn.addEventListener('click', () => removeVeryTaskItem(btn.dataset.itemId));
  });

  // Bind drag-to-reorder
  if (!veryRunning) {
    list.querySelectorAll('.very-task-item').forEach(el => {
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/very-reorder', el.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('reorder-dragging');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('reorder-dragging');
        list.querySelectorAll('.very-task-item').forEach(c => c.classList.remove('drop-above', 'drop-below'));
      });
      el.addEventListener('dragover', (e) => {
        const reorderData = e.dataTransfer.types.includes('text/very-reorder');
        if (!reorderData) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        el.classList.toggle('drop-above', e.clientY < mid);
        el.classList.toggle('drop-below', e.clientY >= mid);
      });
      el.addEventListener('dragleave', () => {
        el.classList.remove('drop-above', 'drop-below');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(e.dataTransfer.getData('text/very-reorder'));
        const toIdx = parseInt(el.dataset.index);
        if (isNaN(fromIdx) || isNaN(toIdx) || fromIdx === toIdx) return;
        const [moved] = veryTaskItems.splice(fromIdx, 1);
        veryTaskItems.splice(toIdx, 0, moved);
        renderVeryTaskList();
      });
    });
  }
}

function updateVeryStartBtn() {
  const btn = document.getElementById('veryStartAllBtn');
  if (btn) btn.disabled = veryTaskItems.length === 0 || veryRunning;
}

// Populate account selector with Very-compatible profiles
async function loadVeryProfiles() {
  const profiles = await API.getProfiles();
  const sel = document.getElementById('veryAccount');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select profile...</option>' +
    profiles.filter(p => p.existingAccount && p.email).map(p =>
      `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.email)})</option>`
    ).join('');
}

// Toggle Click & Collect fields based on delivery selection
document.getElementById('veryDelivery')?.addEventListener('change', (e) => {
  const ccFields = document.getElementById('veryCCFields');
  if (ccFields) {
    ccFields.style.display = e.target.value === 'click-and-collect' ? 'flex' : 'none';
  }
});

// Clear all Very task items
document.getElementById('veryClearAllBtn')?.addEventListener('click', () => {
  if (veryRunning) return;
  veryTaskItems.length = 0;
  renderVeryTaskList();
  updateVeryStartBtn();
  toast('Task list cleared', 'info');
});

// Start all Very tasks
document.getElementById('veryStartAllBtn')?.addEventListener('click', async () => {
  // Pre-check: is the Chrome extension connected?
  try {
    const extStatus = await API.getExtensionStatus();
    if (!extStatus || !extStatus.connected) {
      toast('Chrome extension not connected — open Chrome with Murphy AIO extension installed', 'error');
      return;
    }
  } catch (e) { /* ignore check failure, let it proceed */ }

  const profileId = document.getElementById('veryAccount').value;
  if (!profileId) { toast('Select an account first', 'error'); return; }
  if (veryTaskItems.length === 0) { toast('Drop some cart links first', 'error'); return; }

  const profiles = await API.getProfiles();
  const profile = profiles.find(p => p.id === profileId);
  if (!profile) { toast('Profile not found', 'error'); return; }

  const delivery = document.getElementById('veryDelivery').value;
  const payment = document.getElementById('veryPayment').value;
  const globalQty = Math.max(1, parseInt(document.getElementById('veryGlobalQty').value) || 1);

  veryRunning = true;
  veryCompletedCount = 0;
  veryTimerStart = Date.now();
  updateVeryStartBtn();

  // Show stop button, hide start
  document.getElementById('veryStartAllBtn').style.display = 'none';
  document.getElementById('veryStopAllBtn').style.display = 'inline-flex';

  // Build full task list (expand global qty into multiple runs per item)
  const taskQueue = [];
  for (const item of veryTaskItems) {
    for (let i = 0; i < globalQty; i++) {
      taskQueue.push({ item, runIndex: i });
    }
  }
  const totalRuns = taskQueue.length;

  // Update progress display
  updateVeryProgressDisplay('Starting...', 0, 0, totalRuns);
  startVeryTimer();

  // Reset all item statuses
  veryTaskItems.forEach(item => {
    item.status = 'idle';
    item.progress = 0;
    item.stepLabel = '';
    item.error = null;
  });
  renderVeryTaskList();

  // Process tasks sequentially
  // Multi-item: ATC each item first, full checkout on last item only
  // Single item: full checkout directly
  const isMultiItem = taskQueue.length > 1;

  for (let i = 0; i < taskQueue.length; i++) {
    if (!veryRunning) break;

    const { item } = taskQueue[i];
    const isLastItem = (i === taskQueue.length - 1);
    const atcOnly = isMultiItem && !isLastItem; // ATC-only for all except last

    item.status = 'running';
    item.stepLabel = atcOnly ? 'Carting...' : 'Starting...';
    item.progress = 5;
    renderVeryTaskList();

    updateVeryProgressDisplay(
      atcOnly ? `Carting: ${item.name}` : `Checkout: ${item.name}`,
      ((i) / totalRuns) * 100, veryCompletedCount, totalRuns
    );

    try {
      const isDryRun = document.getElementById('veryTrialRun')?.checked || false;
      const result = await API.veryRun({
        cartLink: item.url,
        taskId: item.id,
        profile: {
          email: profile.email,
          password: profile.password,
          postcode: profile.postcode || profile.shipPostcode || '',
          cvv: profile.cvv || ''
        },
        deliveryMethod: delivery,
        paymentMethod: payment,
        ccPostcode: delivery === 'click-and-collect' ? (document.getElementById('veryCCPostcode')?.value || '') : '',
        ccStoreName: '',
        promoCode: '',
        dryRun: isDryRun,
        atcOnly: atcOnly
      });

      if (result.success && atcOnly) {
        item.status = 'done';
        item.progress = 100;
        item.stepLabel = 'Carted';
        veryCompletedCount++;
        toast(`Carted: ${item.name}`, 'success');
      } else if (result.success && result.dryRun) {
        item.status = 'dry-run';
        item.progress = 100;
        item.stepLabel = 'Dry Run Complete';
        veryCompletedCount++;
        toast(`Trial run complete: ${item.name}`, 'info');
      } else if (result.success) {
        item.status = 'done';
        item.progress = 100;
        item.stepLabel = result.orderNumber ? `Order #${result.orderNumber}` : 'Completed';
        veryCompletedCount++;
        toast(`Checkout success: ${item.name}`, 'success');
      } else {
        const errMsg = (result.error || 'Unknown error').toLowerCase();
        const isOOS = errMsg.includes('out of stock') || errMsg.includes('sold out') || errMsg.includes('unavailable') || errMsg.includes('no longer available');
        item.status = isOOS ? 'oos' : 'error';
        item.progress = 100;
        item.error = isOOS ? 'Out of Stock' : (result.error || 'Unknown error');
        item.stepLabel = item.error;
        toast(isOOS ? `Out of stock: ${item.name}` : `Failed: ${item.name} — ${item.error}`, 'error');
      }
    } catch (err) {
      item.status = 'error';
      item.progress = 100;
      item.error = err.message || 'Exception';
      item.stepLabel = item.error;
    }
    renderVeryTaskList();
    updateVeryProgressDisplay(
      veryRunning ? `Completed ${veryCompletedCount}/${totalRuns}` : 'Stopped',
      ((i + 1) / totalRuns) * 100,
      veryCompletedCount,
      totalRuns
    );
  }

  // Finished
  veryRunning = false;
  stopVeryTimer();
  document.getElementById('veryStartAllBtn').style.display = 'inline-flex';
  document.getElementById('veryStopAllBtn').style.display = 'none';
  updateVeryStartBtn();
  renderVeryTaskList(); // re-render so delete buttons re-enable

  const allDone = veryTaskItems.every(t => t.status === 'done');
  const progressBar = document.getElementById('veryProgressBar');
  if (progressBar) {
    progressBar.classList.remove('active');
    progressBar.classList.add(allDone ? 'done' : 'error');
  }
  updateVeryProgressDisplay(
    allDone ? 'All checkouts complete!' : `Done — ${veryCompletedCount}/${totalRuns} successful`,
    100, veryCompletedCount, totalRuns
  );
});

// Stop all Very tasks — immediately kill current + prevent next
document.getElementById('veryStopAllBtn')?.addEventListener('click', async () => {
  veryRunning = false;

  // Kill the currently running task in the extension
  const runningItem = veryTaskItems.find(t => t.status === 'running' || t.status === '3ds');
  if (runningItem) {
    try {
      await API.veryStop({ taskId: runningItem.id });
    } catch (e) { /* ignore */ }
    runningItem.status = 'error';
    runningItem.error = 'Stopped';
    runningItem.stepLabel = 'Stopped';
    runningItem.progress = 0;
  }

  // Reset UI
  stopVeryTimer();
  document.getElementById('veryStartAllBtn').style.display = 'inline-flex';
  document.getElementById('veryStopAllBtn').style.display = 'none';
  updateVeryStartBtn();
  renderVeryTaskList();
  toast('Stopped', 'info');
});

function updateVeryProgressDisplay(status, pct, completed, total) {
  const statusEl = document.getElementById('veryProgressStatus');
  const countEl = document.getElementById('veryProgressCount');
  const bar = document.getElementById('veryProgressBar');

  if (statusEl) statusEl.textContent = status;
  if (countEl) countEl.textContent = `${completed} / ${total}`;
  if (bar) {
    bar.style.width = pct + '%';
    if (pct > 0 && pct < 100) {
      bar.classList.add('active');
      bar.classList.remove('done', 'error');
    }
  }
}

function startVeryTimer() {
  const timerEl = document.getElementById('veryProgressTimer');
  if (veryTimerInterval) clearInterval(veryTimerInterval);
  veryTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - veryTimerStart) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopVeryTimer() {
  if (veryTimerInterval) {
    clearInterval(veryTimerInterval);
    veryTimerInterval = null;
  }
}

// Listen for extension checkout progress to update Very task items
API.onCheckoutProgress?.((data) => {
  const { taskId, stepLabel, progress } = data;
  const item = veryTaskItems.find(t => t.id === taskId);
  if (item && (item.status === 'running' || item.status === '3ds')) {
    item.progress = progress;
    item.stepLabel = stepLabel;

    // Detect 3DS step — switch to pulsing amber status
    const is3ds = stepLabel && (stepLabel.toLowerCase().includes('3ds') || stepLabel.toLowerCase().includes('awaiting 3ds'));
    if (is3ds && item.status !== '3ds') {
      item.status = '3ds';
      renderVeryTaskList();
      return;
    }

    // Direct DOM update for smoothness
    const bar = document.getElementById(`very-progress-${taskId}`);
    if (bar) bar.style.width = progress + '%';
    const card = document.querySelector(`.very-task-item[data-item-id="${taskId}"]`);
    if (card) {
      const statusEl = card.querySelector('.very-task-item-status');
      if (statusEl) statusEl.textContent = stepLabel;
    }
  }
});

// ============================================================
// BOOT
// ============================================================
init();
