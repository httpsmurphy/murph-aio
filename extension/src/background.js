// ============================================================
// Murph AIO — Extension Background Script
// Standalone Very checkout automation extension
// ============================================================

// ========================= VERY ORDER TRACKER — WEBHOOK =========================
const VERY_WEBHOOK_URL = 'PASTE_YOUR_WEBHOOK_URL_HERE';

/**
 * Send a single webhook with retry + exponential backoff.
 * Retries up to 3 times on failure (rate limit or server error).
 */
async function sendWebhookWithRetry(payload, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(VERY_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return { success: true };
      }

      // Rate limited — wait the retry_after duration
      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const retryAfter = (body.retry_after || 2) * 1000;
        console.warn(`[Very Tracker] Rate limited, retrying in ${retryAfter}ms...`);
        await new Promise((r) => setTimeout(r, retryAfter));
        continue;
      }

      // Server error — retry with backoff
      if (res.status >= 500 && attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`[Very Tracker] Server error ${res.status}, retrying in ${backoff}ms...`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      // Client error or final attempt — fail
      const errorText = await res.text().catch(() => `HTTP ${res.status}`);
      return { success: false, error: errorText };
    } catch (err) {
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000;
        console.warn(`[Very Tracker] Network error, retrying in ${backoff}ms:`, err.message);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Max retries exceeded' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'veryOrderComplete' && request.data) {
    const d = request.data;
    const deliveryInfo = d.deliveryInfo || { mode: 'delivery', deliveryFee: '?' };
    const mode = deliveryInfo.mode || 'delivery';
    const deliveryFee = deliveryInfo.deliveryFee || '?';
    const recipient = d.recipient || {};

    if (VERY_WEBHOOK_URL === 'PASTE_YOUR_WEBHOOK_URL_HERE') {
      console.error('[Very Tracker] Webhook URL not configured in background.js');
      sendResponse({ success: false, error: 'Webhook URL not set' });
      return true;
    }

    // Build one webhook per item — validate data
    const items = d.items && d.items.length > 0
      ? d.items
      : [{ name: '*No items captured*', quantity: '?', price: '?' }];

    // Process webhooks sequentially with retry
    (async () => {
      const results = [];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];

        // Validate & sanitise fields (Discord embed field max: 1024 chars)
        const productName = (item.name || 'Unknown').substring(0, 200);
        const price = (item.price || '?').replace('£', '');
        const quantity = String(item.quantity || 1);

        const fields = [
          { name: 'Site', value: 'Very', inline: true },
          { name: 'Mode', value: mode, inline: true },
          { name: 'Product', value: productName, inline: false },
          { name: 'Price', value: price, inline: true },
          { name: 'Quantity', value: quantity, inline: true },
          { name: 'Delivery', value: deliveryFee, inline: true },
          { name: 'Discord User', value: (d.username || 'Unknown').substring(0, 100), inline: true },
          { name: 'Order ID', value: (d.orderRef || 'Unknown').substring(0, 100), inline: true },
        ];

        // Add recipient info if available (for identity verification)
        if (recipient.name) {
          fields.push({ name: 'Recipient Name', value: recipient.name.substring(0, 100), inline: true });
        }
        if (recipient.email) {
          fields.push({ name: 'Email', value: recipient.email.substring(0, 100), inline: true });
        }
        if (recipient.address) {
          fields.push({ name: 'Address', value: recipient.address.substring(0, 200), inline: false });
        }
        if (recipient.phone) {
          fields.push({ name: 'Phone', value: recipient.phone.substring(0, 20), inline: true });
        }

        const payload = {
          content: idx === 0 ? '@everyone' : undefined,
          embeds: [
            {
              title: 'Successful Checkout!',
              color: 0xf97316, // Orange — Murph AIO brand
              fields: fields,
              timestamp: d.timestamp || new Date().toISOString(),
              footer: {
                text: `Murph AIO | Very Tracker | Item ${idx + 1}/${items.length}`,
              },
            },
          ],
        };

        // Stagger between items (1.2s) to respect rate limits
        if (idx > 0) {
          await new Promise((r) => setTimeout(r, 1200));
        }

        const result = await sendWebhookWithRetry(payload);
        result.item = productName;
        results.push(result);

        if (!result.success) {
          console.error('[Very Tracker] Webhook failed for item:', productName, result.error);
        }
      }

      const allOk = results.every((r) => r.success);
      try {
        sendResponse({ success: allOk, results });
      } catch (e) {
        // sendResponse may fail if message channel closed (tab closed etc)
        console.warn('[Very Tracker] Could not send response back to content script:', e.message);
      }
    })();

    return true; // keep message channel open for async sendResponse
  }

  // Handle manual order entry
  if (request.type === 'veryManualOrder' && request.data) {
    const d = request.data;

    const fields = [
      { name: 'Site', value: 'Very', inline: true },
      { name: 'Mode', value: d.mode || 'delivery', inline: true },
      { name: 'Product', value: (d.product || 'Manual entry').substring(0, 200), inline: false },
      { name: 'Price', value: (d.price || '?').replace('£', ''), inline: true },
      { name: 'Quantity', value: String(d.quantity || 1), inline: true },
      { name: 'Delivery', value: d.deliveryFee || '?', inline: true },
      { name: 'Discord User', value: (d.username || 'Unknown').substring(0, 100), inline: true },
      { name: 'Order ID', value: (d.orderRef || 'Unknown').substring(0, 100), inline: true },
    ];

    const payload = {
      embeds: [{
        title: 'Successful Checkout!',
        description: '*Manually logged*',
        color: 0xf97316,
        fields: fields,
        timestamp: new Date().toISOString(),
        footer: { text: 'Murph AIO | Very Tracker | Manual Entry' },
      }],
    };

    (async () => {
      const result = await sendWebhookWithRetry(payload);
      try {
        sendResponse(result);
      } catch (e) { /* popup may have closed */ }
    })();

    return true;
  }
});

// ========================= VERY CONFIRMATION PAGE WATCHDOG =========================
// Independent safety net: monitors tab URLs for Very confirmation pages.
// If the content script doesn't report an order within 15 seconds of landing
// on the confirmation page, fires a warning webhook so Murphy knows to follow up.

const _veryConfirmationTimers = {};  // tabId -> timeoutId
const _veryConfirmedTabs = new Set(); // tabs where content script DID report

// Listen for successful content script reports to cancel the watchdog
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.type === 'veryOrderComplete' && sender.tab) {
    _veryConfirmedTabs.add(sender.tab.id);
    if (_veryConfirmationTimers[sender.tab.id]) {
      clearTimeout(_veryConfirmationTimers[sender.tab.id]);
      delete _veryConfirmationTimers[sender.tab.id];
    }
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url || !tab.url.includes('very.co.uk/checkout/confirmation')) return;

  // Already confirmed by content script — skip
  if (_veryConfirmedTabs.has(tabId)) return;

  // Clear any existing timer for this tab
  if (_veryConfirmationTimers[tabId]) {
    clearTimeout(_veryConfirmationTimers[tabId]);
  }

  // Start a 15-second watchdog
  _veryConfirmationTimers[tabId] = setTimeout(async () => {
    delete _veryConfirmationTimers[tabId];

    // Check one more time if content script reported
    if (_veryConfirmedTabs.has(tabId)) return;

    // Content script didn't fire — send a warning webhook
    console.warn('[Very Watchdog] Content script did not report order for tab', tabId);

    // Try to get the username from storage
    let username = 'Unknown';
    try {
      const data = await chrome.storage.local.get('discordUsername');
      if (data.discordUsername) username = data.discordUsername;
    } catch (e) {}

    const warningPayload = {
      embeds: [{
        title: 'Possible Missed Order',
        description:
          'A Very confirmation page was detected but the **auto-tracker did not fire**.\n\n' +
          'Check the order manually.',
        color: 0xff0000,
        fields: [
          { name: 'Discord User', value: username, inline: true },
          { name: 'Page URL', value: (tab.url || 'Unknown').substring(0, 500), inline: false },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: 'Murph AIO | Very Watchdog | Auto-detection failed' },
      }],
    };

    if (VERY_WEBHOOK_URL && VERY_WEBHOOK_URL !== 'PASTE_YOUR_WEBHOOK_URL_HERE') {
      await sendWebhookWithRetry(warningPayload);
    }
  }, 15000); // 15 seconds
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  _veryConfirmedTabs.delete(tabId);
  if (_veryConfirmationTimers[tabId]) {
    clearTimeout(_veryConfirmationTimers[tabId]);
    delete _veryConfirmationTimers[tabId];
  }
});

// ============================================================
// MURPH AIO — WebSocket Bridge to Electron App
// ============================================================

let _murphWs = null;
let _murphWsReconnectTimer = null;
const _MURPH_WS_PORT = 17720;
const _MURPH_WS_URL = `ws://127.0.0.1:${_MURPH_WS_PORT}`;

function _murphConnectWS() {
  if (_murphWs && _murphWs.readyState === WebSocket.OPEN) return;

  try {
    _murphWs = new WebSocket(_MURPH_WS_URL);

    _murphWs.onopen = () => {
      console.log('[Murph WS] Connected to Electron app');
      clearTimeout(_murphWsReconnectTimer);
      _murphWs.send(JSON.stringify({ type: 'extension-connected', version: '1.0.0' }));
    };

    _murphWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[Murph WS] Message from Electron:', msg);
        _murphHandleElectronMsg(msg);
      } catch (e) {
        console.error('[Murph WS] Parse error:', e);
      }
    };

    _murphWs.onclose = () => {
      console.log('[Murph WS] Disconnected');
      _murphWs = null;
      _murphWsReconnectTimer = setTimeout(_murphConnectWS, 3000);
    };

    _murphWs.onerror = () => {
      _murphWs = null;
    };
  } catch (e) {
    _murphWsReconnectTimer = setTimeout(_murphConnectWS, 5000);
  }
}

function _murphSendToElectron(msg) {
  if (_murphWs && _murphWs.readyState === WebSocket.OPEN) {
    _murphWs.send(JSON.stringify(msg));
  }
}

async function _murphHandleElectronMsg(msg) {
  switch (msg.type) {
    case 'very-start-task': {
      // Stop automation on any existing Very tabs (but leave them open)
      try {
        const veryTabs = await chrome.tabs.query({ url: '*://*.very.co.uk/*' });
        for (const t of veryTabs) {
          try { await chrome.tabs.sendMessage(t.id, { action: 'very-stop' }); } catch (e) {}
        }
        if (veryTabs.length > 0) console.log('[Murph] Stopped automation on', veryTabs.length, 'existing Very tab(s)');
      } catch (e) {}

      const config = msg.config;
      config.taskId = msg.taskId; // Include taskId so content script knows which task it's running
      await chrome.storage.local.set({ veryActiveTask: config });
      const createdTabId = (await chrome.tabs.create({ url: config.cartLink, active: true })).id;
      await chrome.storage.local.set({ veryActiveTabId: createdTabId, veryTaskId: msg.taskId });

      _murphSendToElectron({ type: 'very-task-started', taskId: msg.taskId, tabId: createdTabId });
      break;
    }

    case 'very-stop-task': {
      const { veryActiveTabId } = await chrome.storage.local.get('veryActiveTabId');
      if (veryActiveTabId) {
        try { await chrome.tabs.sendMessage(veryActiveTabId, { action: 'very-stop' }); }
        catch (e) { /* tab may not exist */ }
      }
      await chrome.storage.local.remove(['veryActiveTask', 'veryActiveTabId', 'veryTaskId']);
      _murphSendToElectron({ type: 'very-task-stopped', taskId: msg.taskId });
      break;
    }

    case 'ping':
      _murphSendToElectron({ type: 'pong' });
      break;
  }
}

// Start connection + periodic retry
_murphConnectWS();
setInterval(() => {
  if (!_murphWs || _murphWs.readyState !== WebSocket.OPEN) {
    _murphConnectWS();
  }
}, 10000);

// Listen for checkout bot messages from content script (very-content.js)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Very module: status updates from content script -> Electron
  if (request.action === 'very-status') {
    chrome.storage.local.get(['veryTaskId', 'veryActiveTabId'], (result) => {
      // Ignore status from ghost tabs (tabs running a stale/different task)
      if (request.taskId && result.veryTaskId && request.taskId !== result.veryTaskId) {
        console.log('[Murph] Ignoring ghost status from old task:', request.taskId, 'current:', result.veryTaskId);
        return;
      }
      // Update tracked tab to the REAL very.co.uk tab (Stellar links redirect,
      // so the initial tab ID may differ from the final very.co.uk tab)
      if (sender.tab && sender.tab.id) {
        chrome.storage.local.set({ veryActiveTabId: sender.tab.id });
      }
      _murphSendToElectron({
        type: 'very-status',
        taskId: result.veryTaskId,
        step: request.step,
        message: request.message,
        url: request.url
      });
    });
  }

  // Very module: checkout result from content script -> Electron
  if (request.action === 'very-result') {
    chrome.storage.local.get(['veryTaskId', 'veryActiveTabId'], async (result) => {
      // Ignore results from ghost tabs
      if (request.taskId && result.veryTaskId && request.taskId !== result.veryTaskId) {
        console.log('[Murph] Ignoring ghost result from old task:', request.taskId, 'current:', result.veryTaskId);
        return;
      }
      _murphSendToElectron({
        type: 'very-result',
        taskId: result.veryTaskId,
        success: request.success,
        orderRef: request.orderRef,
        error: request.error,
        dryRun: request.dryRun || false
      });

      // Close the tab after a REAL successful checkout (not ATC, not dry run)
      // Delay so the confirmation page is visible before closing
      const isATC = request.orderRef === 'ATC';
      const isDryRun = request.dryRun || false;
      if (!isATC && !isDryRun && request.success && result.veryActiveTabId) {
        const tabToClose = result.veryActiveTabId;
        setTimeout(async () => {
          try {
            await chrome.tabs.remove(tabToClose);
            console.log('[Murph] Closed tab after checkout:', tabToClose);
          } catch (e) { /* tab may already be gone */ }
        }, 10000); // 10s so user can see confirmation
      }

      await chrome.storage.local.remove(['veryActiveTask', 'veryActiveTabId', 'veryTaskId']);
    });
  }

  // Tab ID check — content script asks "what's my tab ID?"
  if (request.action === 'murph-get-tab-id') {
    sendResponse({ tabId: sender.tab?.id || null });
    return true;
  }

  // WebSocket status check
  if (request.action === 'get-ws-status') {
    sendResponse({ connected: _murphWs && _murphWs.readyState === WebSocket.OPEN });
    return true;
  }

  return true;
});

// Clean up if the Very automation tab is closed mid-task
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { veryActiveTabId, veryTaskId } = await chrome.storage.local.get(['veryActiveTabId', 'veryTaskId']);
  if (veryTaskId && tabId === veryActiveTabId) {
    console.log('[Murph] Active Very tab closed, cleaning up');
    _murphSendToElectron({
      type: 'very-result',
      taskId: veryTaskId,
      success: false,
      error: 'Tab was closed'
    });
    await chrome.storage.local.remove(['veryActiveTask', 'veryActiveTabId', 'veryTaskId']);
  }
});
