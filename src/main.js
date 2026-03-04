const { app, BrowserWindow, ipcMain, net, Notification, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const { WebSocketServer } = require('ws');

const store = new Store();
let mainWindow;
console.log('[main] Murph AIO starting up...');

// ============================================================
// WEBSOCKET SERVER — Bridge to Chrome Extension
// ============================================================

const WS_PORT = 17720;
let wss = null;
let extensionSocket = null;
const veryPendingTasks = new Map(); // taskId → { resolve, reject, timeout }

function startWebSocketServer() {
  try {
    wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
    console.log(`[ws] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);

    wss.on('connection', (socket) => {
      console.log('[ws] Extension connected');
      extensionSocket = socket;

      // Notify renderer of connection
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('extension-status', { connected: true });
      }

      socket.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleExtensionMessage(msg);
        } catch (e) {
          console.error('[ws] Failed to parse message:', e);
        }
      });

      socket.on('close', () => {
        console.log('[ws] Extension disconnected');
        extensionSocket = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension-status', { connected: false });
        }
      });

      socket.on('error', (err) => {
        console.error('[ws] Socket error:', err.message);
      });
    });

    wss.on('error', (err) => {
      console.error('[ws] Server error:', err.message);
      if (err.code === 'EADDRINUSE') {
        console.log('[ws] Port in use, retrying in 3s...');
        setTimeout(startWebSocketServer, 3000);
      }
    });
  } catch (e) {
    console.error('[ws] Failed to start server:', e.message);
  }
}

function sendToExtension(msg) {
  if (extensionSocket && extensionSocket.readyState === 1) {
    extensionSocket.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function handleExtensionMessage(msg) {
  console.log('[ws] Message from extension:', msg.type);

  switch (msg.type) {
    case 'extension-connected':
      console.log('[ws] Extension version:', msg.version);
      break;

    case 'pong':
      break;

    case 'very-status': {
      // Forward checkout progress to renderer
      const { taskId, step, message } = msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Map step names to progress percentages
        const stepProgress = {
          login: 15, basket: 30, delivery: 45,
          'click-and-collect': 50, payment: 65, ccv: 80,
          '3ds': 85, confirmation: 100, error: 0
        };
        const pct = stepProgress[step] || 50;
        mainWindow.webContents.send('checkout-progress', {
          taskId, step: Object.keys(stepProgress).indexOf(step) + 1,
          stepLabel: message, progress: pct
        });
      }
      break;
    }

    case 'very-result': {
      // Checkout complete or failed
      const { taskId, success, orderRef, error, dryRun } = msg;
      const pending = veryPendingTasks.get(taskId);
      if (pending) {
        clearTimeout(pending.timeout);
        veryPendingTasks.delete(taskId);
        pending.resolve({ success, orderRef, error, dryRun });
      }
      break;
    }

    case 'very-task-started':
      console.log('[ws] Very task started, tabId:', msg.tabId);
      break;

    case 'very-task-stopped':
      console.log('[ws] Very task stopped');
      break;
  }
}

// --- Supabase Config (checkout tracking) ---
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

async function logCheckoutToSupabase(data) {
  try {
    await net.fetch(`${SUPABASE_URL}/rest/v1/checkouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(data)
    });
    console.log('[supabase] Checkout logged:', data.status, data.product_code);
  } catch (e) {
    console.error('[supabase] Failed to log checkout:', e.message);
  }
}

// --- Local checkout log (for dashboard panel) ---
function logCheckoutLocally(data) {
  const log = store.get('checkoutLog') || [];
  log.unshift({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    productCode: data.product_code || null,
    quantity: data.quantity || 0,
    orderNumber: data.order_number || null,
    profileName: data.profile_name || null,
    proxyGroupName: data.proxy_group_name || null,
    deliveryMethod: data.delivery_method || null,
    price: data.price || null,
    module: data.module || 'freemans',
    status: data.status || 'unknown',
    error: data.error || null,
    durationSeconds: data.duration_seconds || null
  });
  if (log.length > 100) log.length = 100;
  store.set('checkoutLog', log);
}

// Valid license keys
const VALID_KEYS = [
  'MURPH-0001-AAAA-BBBB',
  'MURPH-0002-CCCC-DDDD',
  'MURPH-0003-EEEE-FFFF',
  'MURPH-0004-GGGG-HHHH',
  'MURPH-0005-IIII-JJJJ',
  'MURPH-TEST-1234-5678'
];

// --- Remote license validation (Supabase) ---
async function validateKeyRemote(key) {
  // If Supabase isn't configured, fall back to local VALID_KEYS
  if (SUPABASE_URL.includes('YOUR_PROJECT')) {
    console.log('[license] Supabase not configured — using local key list');
    return VALID_KEYS.includes(key)
      ? { valid: true, owner: 'Local', key }
      : { valid: false, error: 'Invalid license key' };
  }
  try {
    const response = await net.fetch(
      `${SUPABASE_URL}/rest/v1/license_keys?key=eq.${encodeURIComponent(key)}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    const data = await response.json();
    if (!data || data.length === 0) return { valid: false, error: 'Invalid license key' };
    const keyRow = data[0];
    if (!keyRow.active) return { valid: false, error: 'Key has been deactivated' };
    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
      return { valid: false, error: 'Key has expired' };
    }
    return { valid: true, owner: keyRow.owner || 'Unknown', key: keyRow.key };
  } catch (e) {
    console.error('[license] Remote validation error:', e.message);
    return { valid: false, error: 'Could not connect to server. Check your internet connection.' };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 660,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d0d0d',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Validate stored key (remote if Supabase configured, local fallback)
  const savedKey = store.get('licenseKey');
  if (savedKey) {
    validateKeyRemote(savedKey).then(result => {
      if (result.valid) {
        store.set('licenseOwner', result.owner || null);
        mainWindow.loadFile(path.join(__dirname, 'app.html'));
      } else {
        store.set('licenseError', result.error || 'Invalid key');
        mainWindow.loadFile(path.join(__dirname, 'activation.html'));
      }
    }).catch(() => {
      store.set('licenseError', 'Could not validate key. Check your internet.');
      mainWindow.loadFile(path.join(__dirname, 'activation.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'activation.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Log renderer console messages to main process terminal
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
    console.log(`[renderer:${prefix}] ${message}`);
  });
}

// --- IPC: Key management ---
ipcMain.handle('validate-key', async (event, key) => {
  const k = key.trim().toUpperCase();
  const result = await validateKeyRemote(k);
  if (result.valid) {
    store.set('licenseKey', k);
    store.set('licenseOwner', result.owner || null);
    store.delete('licenseError');
    return { success: true, owner: result.owner };
  }
  return { success: false, error: result.error || 'Invalid license key' };
});

ipcMain.handle('check-key', async () => {
  const k = store.get('licenseKey');
  if (!k) return { valid: false, key: null };
  const result = await validateKeyRemote(k);
  return { valid: result.valid, key: k, owner: result.owner || store.get('licenseOwner') || null, error: result.error || null };
});

ipcMain.handle('deactivate-key', () => {
  store.delete('licenseKey');
  mainWindow.loadFile(path.join(__dirname, 'activation.html'));
  return { success: true };
});

ipcMain.handle('go-app', () => {
  mainWindow.loadFile(path.join(__dirname, 'app.html'));
});

// --- IPC: Profile management ---
ipcMain.handle('get-profiles', () => {
  return store.get('profiles') || [];
});

ipcMain.handle('save-profile', (event, profile) => {
  const profiles = store.get('profiles') || [];
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  else profiles.push(profile);
  store.set('profiles', profiles);
  return { success: true, profiles };
});

ipcMain.handle('delete-profile', (event, id) => {
  let profiles = store.get('profiles') || [];
  profiles = profiles.filter(p => p.id !== id);
  store.set('profiles', profiles);
  return { success: true, profiles };
});

// --- IPC: Task management ---
ipcMain.handle('get-tasks', () => {
  return store.get('tasks') || [];
});

ipcMain.handle('save-task', (event, task) => {
  const tasks = store.get('tasks') || [];
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  store.set('tasks', tasks);
  return { success: true, tasks };
});

ipcMain.handle('delete-task', (event, id) => {
  let tasks = store.get('tasks') || [];
  tasks = tasks.filter(t => t.id !== id);
  store.set('tasks', tasks);
  return { success: true, tasks };
});

ipcMain.handle('clear-tasks', () => {
  store.set('tasks', []);
  return { success: true, tasks: [] };
});

// ============================================================
// CHECKOUT FLOW ENGINE — Helper Functions
// ============================================================

/** Send checkout progress update to renderer */
function sendProgress(taskId, step, stepLabel, progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('checkout-progress', { taskId, step, stepLabel, progress });
  }
}

/** Wait for page to fully load — checks readyState first, then small buffer */
async function waitForPageReady(win, bufferMs = 300) {
  try {
    await win.webContents.executeJavaScript(`
      new Promise(resolve => {
        if (document.readyState === 'complete') resolve();
        else window.addEventListener('load', resolve);
      })
    `);
  } catch (e) { /* page may be mid-navigation */ }
  if (bufferMs > 0) await new Promise(r => setTimeout(r, bufferMs));
}

/** Detect which checkout page we're on */
async function detectCheckoutPage(win) {
  try {
    return await win.webContents.executeJavaScript(`
      (function() {
        var path = window.location.pathname.toLowerCase();
        if (path.includes('co_login')) return 'login';
        if (path.includes('co_personal_details') || path.includes('personal_details') || path.includes('registration')) return 'personal_details';
        if (path.includes('co_delivery') || path.includes('delivery')) return 'delivery';
        if (path.includes('co_payment_cash_verify') || path.includes('payment_verify') || path.includes('payment_cash')) return 'payment_verify';
        if (path.includes('co_payment') || path.includes('payment')) return 'payment';
        if (path.includes('co_confirm') || path.includes('co_order_review')) return 'confirmation';
        if (path.includes('co_thankyou') || path.includes('thank') || path.includes('order_complete') || path.includes('receipt')) return 'order_complete';
        // Fallback: check headings
        var h = document.querySelector('h1, h2, .page-title, .checkout-title');
        var t = h ? h.textContent.toLowerCase() : '';
        if (t.includes('delivery')) return 'delivery';
        if (t.includes('payment') || t.includes('card')) return 'payment';
        if (t.includes('review') || t.includes('confirm')) return 'confirmation';
        if (t.includes('thank') || t.includes('order placed') || t.includes('complete')) return 'order_complete';
        // Captcha detection
        if (document.querySelector('iframe[src*="recaptcha"]') ||
            document.querySelector('.g-recaptcha') ||
            document.querySelector('iframe[src*="hcaptcha"]') ||
            document.querySelector('.h-captcha') ||
            document.querySelector('.cf-turnstile') ||
            document.querySelector('iframe[src*="challenges.cloudflare"]')) return 'captcha';
        return 'unknown';
      })()
    `);
  } catch (e) { return 'unknown'; }
}

/** Detect captcha/verification on the page */
async function detectCaptcha(win) {
  try {
    return await win.webContents.executeJavaScript(`
      (function() {
        // reCAPTCHA
        if (window.grecaptcha) return 'recaptcha';
        if (document.querySelector('iframe[src*="recaptcha"]')) return 'recaptcha';
        if (document.querySelector('.g-recaptcha')) return 'recaptcha';
        // hCaptcha
        if (document.querySelector('iframe[src*="hcaptcha"]')) return 'hcaptcha';
        if (document.querySelector('.h-captcha')) return 'hcaptcha';
        // Cloudflare Turnstile
        if (document.querySelector('iframe[src*="challenges.cloudflare"]')) return 'cloudflare';
        if (document.querySelector('.cf-turnstile')) return 'cloudflare';
        // Generic verification text
        var text = (document.body.innerText || '').toLowerCase();
        if (text.includes('verify you are human') ||
            text.includes('are you a robot') ||
            text.includes('complete the security check') ||
            text.includes('please verify') ||
            text.includes('bot detection')) return 'generic';
        return null;
      })()
    `);
  } catch (e) { return null; }
}

/** Click the primary continue/submit button on the page */
async function clickContinueButton(win) {
  return win.webContents.executeJavaScript(`
    (function() {
      var selectors = [
        '#applybutton', '#continueButton', '#continue-btn',
        'input[type="submit"]', 'button[type="submit"]',
        '.continue-button', '#btnContinue', '#submitButton',
        'a.continue', '[name="submit"]', '.btn-continue'
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el && el.offsetParent !== null) { el.click(); return { clicked: true, selector: selectors[i] }; }
      }
      // Fallback: find by text
      var btns = document.querySelectorAll('button, input[type="submit"], a.btn, a');
      for (var j = 0; j < btns.length; j++) {
        var txt = (btns[j].textContent || btns[j].value || '').toLowerCase().trim();
        if (txt.includes('continue') || txt.includes('proceed') || txt === 'next' || txt.includes('submit order') || txt.includes('place order')) {
          btns[j].click();
          return { clicked: true, selector: 'text:' + txt };
        }
      }
      return { clicked: false };
    })()
  `);
}

// --- IPC: Run Freemans task (Full Checkout Engine) ---
ipcMain.handle('freemans-run', async (event, { productUrl, quantity, taskId, profile, deliveryMethod, proxyGroupId }) => {
  console.log('[freemans-run] Starting task:', taskId, '| URL:', productUrl, '| Qty:', quantity, '| Delivery:', deliveryMethod, '| Profile:', profile ? profile.name : 'none');
  const settings = store.get('settings') || {};
  const taskWin = new BrowserWindow({
    width: 1200,
    height: 800,
    show: settings.debugMode || false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:freemans' }
  });

  function progress(step, label, pct) {
    sendProgress(taskId, step, label, pct);
  }

  // Set proxy if enabled
  const proxy = getNextProxy(settings, proxyGroupId || null);
  if (proxy) {
    await taskWin.webContents.session.setProxy({ proxyRules: proxy });
    console.log('[freemans-run] Using proxy:', proxy);
  }

  try {
    // =============== STEP 1: ADD ITEMS TO BAG ===============
    progress(1, 'Adding to bag...', 5);
    await taskWin.loadURL(productUrl);

    const result = await taskWin.webContents.executeJavaScript(`
      (async function() {
        var m = window.location.href.match(/\\/A-([^\\/\\?]+)/);
        var productCode = m ? m[1] : null;
        if (!productCode) {
          var el = document.querySelector('[class*="productCode"]');
          if (el) { var cm = el.textContent.match(/(\\d+\\w+)/); if (cm) productCode = cm[1]; }
        }
        if (!productCode) return { success: false, error: 'Could not detect product code' };

        var totalQty = ${quantity};
        var lines = Math.ceil(totalQty / 6);
        for (var i = 0; i < lines; i++) {
          var url = '/web/main/BagContentChanges.asp?products=' +
            encodeURIComponent(productCode + '|N/A|N/A|1|N/A|N||') +
            '&brandid=&itemDisplayCount=3&plusSizeNavigation=false&bagImageCatNo=&_=' + Date.now();
          var r = await fetch(url, { method: 'GET', credentials: 'include' });
          if (!r.ok) return { success: false, error: 'Failed to add item (HTTP ' + r.status + ')' };
          if (i < lines - 1) await new Promise(r => setTimeout(r, 500));
        }

        var res = await fetch('/web/main/bag.asp?realestate=siteheaderlinks&linkname=bag', { credentials: 'include' });
        var html = await res.text();
        var parser = new DOMParser();
        var doc = parser.parseFromString(html, 'text/html');
        var form = doc.getElementById('bagForm');
        if (!form) return { success: false, error: 'Could not find bag form' };

        var fd = new URLSearchParams();
        form.querySelectorAll('input, select').forEach(el => { if (el.name) fd.set(el.name, el.value); });
        var ss = form.querySelectorAll('select.qty');
        var ln = Math.ceil(totalQty / 6), rm = totalQty % 6 || 6, lt = Math.min(ln, ss.length);
        for (var i = 0; i < lt; i++) {
          fd.set(ss[i].name, (i === lt - 1 ? rm : 6).toString());
        }
        fd.set('action', 'updateTrolley');
        var pr = await fetch('/web/main/bag.asp', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: fd.toString()
        });
        if (!pr.ok) return { success: false, error: 'Failed to update quantities' };

        return { success: true, productCode, quantity: totalQty, lines };
      })()
    `);

    if (!result.success) { taskWin.close(); return result; }

    progress(1, 'Items in bag', 20);

    // =============== STEP 2: LOGIN / REGISTER ===============
    const hasProfile = profile && (profile.existingAccount ? profile.email : profile.firstName);
    if (!hasProfile) {
      // No profile — stop after adding to bag
      taskWin.close();
      return { ...result, checkoutReady: false, checkoutMode: 'none' };
    }

    progress(2, profile.existingAccount ? 'Logging in...' : 'Registering...', 25);
    await taskWin.loadURL('https://www.freemans.com/web/main/co_login.asp');
    await waitForPageReady(taskWin, 200);

    const profileJSON = JSON.stringify(profile).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    if (profile.existingAccount) {
      // Fill login form
      await taskWin.webContents.executeJavaScript(`
        (function() {
          var p = JSON.parse('${profileJSON}');
          var emailField = document.getElementById('Email')
            || document.getElementById('emailAddress')
            || document.querySelector('input[name="emailAddress"]')
            || document.querySelector('input[name="Email"]')
            || document.querySelector('input[type="email"]');
          var passField = document.getElementById('Password')
            || document.getElementById('password')
            || document.querySelector('input[name="password"]')
            || document.querySelector('input[name="Password"]')
            || document.querySelector('input[type="password"]');
          if (emailField) {
            emailField.value = p.email;
            emailField.dispatchEvent(new Event('input', { bubbles: true }));
            emailField.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (passField) {
            passField.value = p.password;
            passField.dispatchEvent(new Event('input', { bubbles: true }));
            passField.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()
      `);
      await clickContinueButton(taskWin);
      await waitForPageReady(taskWin, 500);
    } else {
      // Click register, fill registration form
      await taskWin.webContents.executeJavaScript(`
        (function() { var r = document.getElementById('registerLink'); if (r) r.click(); })()
      `);
      await new Promise(r => setTimeout(r, 800));

      await taskWin.webContents.executeJavaScript(`
        (function() {
          var p = JSON.parse('${profileJSON}');
          function setVal(id, val) {
            var el = document.getElementById(id);
            if (el && val) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
          }
          function pad2(v) { var s = String(v); return s.length===1?'0'+s:s; }
          setVal('Title', p.title||'Mr'); setVal('FirstName', p.firstName); setVal('LastName', p.lastName);
          setVal('dob_day', pad2(p.dobDay)); setVal('dob_month', pad2(p.dobMonth)); setVal('dob_year', p.dobYear);
          setVal('DayTimeTelephone', p.phone); setVal('houseId', p.houseNum); setVal('postCode', p.postcode);
          setVal('Email', p.email); setVal('ConfirmEmail', p.email);
          setVal('Password', p.password); setVal('confirmPassword', p.password);
          var o = document.getElementById('No_Further_Marketing_Mailings');
          if (o && !o.checked) { o.checked = true; o.dispatchEvent(new Event('change',{bubbles:true})); }
          if (p.postcode && p.houseNum) {
            var fb = document.getElementById('searchAddressImageButton');
            if (fb) setTimeout(function(){fb.click();}, 300);
          }
        })()
      `);
      await new Promise(r => setTimeout(r, 1500));
      await clickContinueButton(taskWin);
      await waitForPageReady(taskWin, 500);
    }

    const postLoginUrl = await taskWin.webContents.executeJavaScript('window.location.href');
    console.log('[freemans-run] After login/register, now at:', postLoginUrl);

    // =============== STEP 3: CHECKOUT PAGE LOOP ===============
    const MAX_PAGES = 8;
    let pagesVisited = 0;
    let orderPlaced = false;

    while (pagesVisited < MAX_PAGES && !orderPlaced) {
      pagesVisited++;
      const currentUrl = await taskWin.webContents.executeJavaScript('window.location.href');
      const page = await detectCheckoutPage(taskWin);
      console.log(`[freemans-run] Page ${pagesVisited}: detected="${page}" url="${currentUrl}"`);

      switch (page) {
        case 'personal_details': {
          progress(2, 'Personal details...', 35);
          if (!profile.existingAccount) {
            await taskWin.webContents.executeJavaScript(`
              (function() {
                var p = JSON.parse('${profileJSON}');
                function setVal(id, val) {
                  var el = document.getElementById(id);
                  if (el && val && !el.value) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
                }
                function pad2(v) { var s = String(v); return s.length===1?'0'+s:s; }
                setVal('Title', p.title||'Mr'); setVal('FirstName', p.firstName); setVal('LastName', p.lastName);
                setVal('dob_day', pad2(p.dobDay)); setVal('dob_month', pad2(p.dobMonth)); setVal('dob_year', p.dobYear);
                setVal('DayTimeTelephone', p.phone); setVal('houseId', p.houseNum); setVal('postCode', p.postcode);
                setVal('Email', p.email); setVal('ConfirmEmail', p.email);
                setVal('Password', p.password); setVal('confirmPassword', p.password);
                var o = document.getElementById('No_Further_Marketing_Mailings');
                if (o && !o.checked) { o.checked = true; o.dispatchEvent(new Event('change',{bubbles:true})); }
                if (p.postcode && p.houseNum) {
                  var fb = document.getElementById('searchAddressImageButton');
                  if (fb) setTimeout(function(){fb.click();}, 500);
                }
              })()
            `);
            await new Promise(r => setTimeout(r, 1500));
          }
          await clickContinueButton(taskWin);
          await waitForPageReady(taskWin, 500);
          break;
        }

        case 'delivery': {
          progress(3, 'Selecting delivery...', 50);
          const dm = deliveryMethod || 'standard';
          await taskWin.webContents.executeJavaScript(`
            (function() {
              var method = '${dm}';
              var keywords = {
                standard: ['standard', 'free', 'economy'],
                nextday: ['next day', 'next-day', 'nextday', 'tomorrow'],
                express: ['express', 'fast', 'priority'],
                named: ['named', 'choose', 'select day', 'pick a day']
              };
              var targets = keywords[method] || keywords['standard'];
              var radios = document.querySelectorAll('input[type="radio"][name*="delivery"], input[type="radio"][name*="Delivery"]');
              for (var i = 0; i < radios.length; i++) {
                var label = radios[i].closest('label') || document.querySelector('label[for="'+radios[i].id+'"]');
                var text = label ? label.textContent.toLowerCase() : '';
                var row = radios[i].closest('tr, .delivery-option, .delivery-row, div');
                if (row) text += ' ' + row.textContent.toLowerCase();
                for (var j = 0; j < targets.length; j++) {
                  if (text.includes(targets[j])) { radios[i].checked = true; radios[i].click(); radios[i].dispatchEvent(new Event('change',{bubbles:true})); return; }
                }
              }
              // Fallback: select first option
              if (radios.length > 0) { radios[0].checked = true; radios[0].click(); radios[0].dispatchEvent(new Event('change',{bubbles:true})); return; }
              // Try select dropdown
              var sel = document.querySelector('select[name*="delivery"], select[name*="Delivery"]');
              if (sel) {
                for (var k = 0; k < sel.options.length; k++) {
                  var ot = sel.options[k].textContent.toLowerCase();
                  for (var j = 0; j < targets.length; j++) {
                    if (ot.includes(targets[j])) { sel.selectedIndex = k; sel.dispatchEvent(new Event('change',{bubbles:true})); return; }
                  }
                }
              }
            })()
          `);
          await new Promise(r => setTimeout(r, 300));
          await clickContinueButton(taskWin);
          await waitForPageReady(taskWin, 400);
          break;
        }

        case 'payment': {
          progress(4, 'Entering payment...', 70);
          if (!profile.cardNumber) {
            taskWin.close();
            return { ...result, checkoutReady: false, checkoutError: 'No card details in profile', checkoutStep: 'payment' };
          }
          await taskWin.webContents.executeJavaScript(`
            (function() {
              var p = JSON.parse('${profileJSON}');
              function trySet(selectors, val) {
                for (var i = 0; i < selectors.length; i++) {
                  var el = document.querySelector(selectors[i]);
                  if (el) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
                }
                return false;
              }
              trySet(['#cardNumber','#CardNumber','#card-number','input[name="cardNumber"]','input[name="CardNumber"]','input[name="card_number"]','input[autocomplete="cc-number"]'], p.cardNumber);
              trySet(['#cardholderName','#CardholderName','#cardName','#CardName','#name-on-card','input[name="cardholderName"]','input[autocomplete="cc-name"]'], p.cardName);
              trySet(['#expiryMonth','#ExpiryMonth','#expiry-month','select[name="expiryMonth"]','select[name="ExpiryMonth"]','select[autocomplete="cc-exp-month"]'], p.expiryMonth);
              trySet(['#expiryYear','#ExpiryYear','#expiry-year','select[name="expiryYear"]','select[name="ExpiryYear"]','select[autocomplete="cc-exp-year"]'], p.expiryYear);
              trySet(['#cvv','#CVV','#securityCode','#SecurityCode','#cvv2','input[name="cvv"]','input[name="CVV"]','input[name="securityCode"]','input[autocomplete="cc-csc"]'], p.cvv);
            })()
          `);
          await new Promise(r => setTimeout(r, 300));
          await clickContinueButton(taskWin);
          await waitForPageReady(taskWin, 500);
          break;
        }

        case 'confirmation': {
          // Freemans co_confirm.asp has payment fields AND place order button on same page
          // First, fill payment details if card fields exist on this page
          if (profile.cardNumber) {
            progress(4, 'Entering payment...', 70);
            const paymentResult = await taskWin.webContents.executeJavaScript(`
              (function() {
                var p = JSON.parse('${profileJSON}');
                var filled = [];
                function trySet(selectors, val, name) {
                  if (!val) return false;
                  for (var i = 0; i < selectors.length; i++) {
                    var el = document.querySelector(selectors[i]);
                    if (el) { el.value = val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); filled.push(name + ':' + selectors[i]); return true; }
                  }
                  return false;
                }
                // Try broad card field selectors
                trySet(['#cardNumber','#CardNumber','#card-number','input[name="cardNumber"]','input[name="CardNumber"]','input[name="card_number"]','input[autocomplete="cc-number"]','input[id*="card" i][id*="number" i]','input[name*="card" i][name*="number" i]'], p.cardNumber, 'cardNum');
                trySet(['#cardholderName','#CardholderName','#cardName','#CardName','#name-on-card','input[name="cardholderName"]','input[name="CardholderName"]','input[autocomplete="cc-name"]','input[id*="holder" i]','input[name*="holder" i]','input[id*="cardName" i]'], p.cardName, 'cardName');
                trySet(['#expiryMonth','#ExpiryMonth','#expiry-month','select[name="expiryMonth"]','select[name="ExpiryMonth"]','select[autocomplete="cc-exp-month"]','select[id*="expiry" i][id*="month" i]','select[name*="expiry" i][name*="month" i]'], p.expiryMonth, 'expMonth');
                trySet(['#expiryYear','#ExpiryYear','#expiry-year','select[name="expiryYear"]','select[name="ExpiryYear"]','select[autocomplete="cc-exp-year"]','select[id*="expiry" i][id*="year" i]','select[name*="expiry" i][name*="year" i]'], p.expiryYear, 'expYear');
                trySet(['#cvv','#CVV','#securityCode','#SecurityCode','#cvv2','input[name="cvv"]','input[name="CVV"]','input[name="securityCode"]','input[autocomplete="cc-csc"]','input[id*="cvv" i]','input[id*="security" i][id*="code" i]','input[name*="security" i]'], p.cvv, 'cvv');

                // Also check for iframes (payment providers often use iframes)
                var iframes = document.querySelectorAll('iframe');
                var iframeInfo = [];
                iframes.forEach(function(f) { iframeInfo.push(f.src || f.id || 'unnamed'); });

                // Dump all input/select fields on the page for debugging
                var allFields = [];
                document.querySelectorAll('input, select, textarea').forEach(function(el) {
                  if (el.type !== 'hidden') allFields.push((el.tagName + ' id=' + el.id + ' name=' + el.name + ' type=' + el.type).trim());
                });

                return { filled: filled, iframes: iframeInfo, allFields: allFields };
              })()
            `);
            console.log('[freemans-run] Payment fill result:', JSON.stringify(paymentResult));
            await new Promise(r => setTimeout(r, 300));
          }

          // Now try to place the order
          progress(5, 'Placing order...', 90);
          const placeResult = await taskWin.webContents.executeJavaScript(`
            (function() {
              // Try specific selectors first
              var selectors = ['#placeOrder','#PlaceOrder','#place-order','#confirmOrder','#ConfirmOrder','#submitOrder','#btnPlaceOrder','#applybutton','button[name="placeOrder"]','input[name="placeOrder"]','input[type="submit"]','button[type="submit"]'];
              for (var i = 0; i < selectors.length; i++) {
                var el = document.querySelector(selectors[i]);
                if (el) { return { found: true, selector: selectors[i], text: (el.textContent||el.value||'').trim().substring(0,50) }; }
              }
              // Fallback: find by text
              var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button, .btn');
              var allBtns = [];
              for (var j = 0; j < btns.length; j++) {
                var txt = (btns[j].textContent || btns[j].value || '').trim();
                allBtns.push(btns[j].tagName + '.' + (btns[j].className||'').substring(0,30) + '="' + txt.substring(0,40) + '"');
                var lower = txt.toLowerCase();
                if (lower.includes('place order') || lower.includes('confirm order') || lower.includes('complete order') || lower.includes('buy now') || lower.includes('submit order') || lower.includes('pay now')) {
                  return { found: true, selector: 'text:' + txt, text: txt };
                }
              }
              return { found: false, allButtons: allBtns };
            })()
          `);
          console.log('[freemans-run] Place order scan:', JSON.stringify(placeResult));

          if (placeResult.found) {
            // Actually click it
            await taskWin.webContents.executeJavaScript(`
              (function() {
                var selectors = ['#placeOrder','#PlaceOrder','#place-order','#confirmOrder','#ConfirmOrder','#submitOrder','#btnPlaceOrder','#applybutton','button[name="placeOrder"]','input[name="placeOrder"]','input[type="submit"]','button[type="submit"]'];
                for (var i = 0; i < selectors.length; i++) {
                  var el = document.querySelector(selectors[i]);
                  if (el) { el.click(); return; }
                }
                var btns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, a.button, .btn');
                for (var j = 0; j < btns.length; j++) {
                  var txt = (btns[j].textContent || btns[j].value || '').toLowerCase();
                  if (txt.includes('place order') || txt.includes('confirm order') || txt.includes('complete order') || txt.includes('buy now') || txt.includes('submit order') || txt.includes('pay now')) {
                    btns[j].click(); return;
                  }
                }
              })()
            `);
            await waitForPageReady(taskWin, 500);
          } else {
            // Couldn't find button — log all buttons and try clickContinueButton as last resort
            console.log('[freemans-run] No place order button found, trying clickContinueButton fallback');
            await clickContinueButton(taskWin);
            await waitForPageReady(taskWin, 400);
          }
          break;
        }

        case 'payment_verify': {
          // Payment processing page — DON'T click anything, just wait for redirect
          progress(4, 'Processing payment...', 85);
          console.log('[freemans-run] Payment processing — polling for redirect...');
          let verifyDone = false;
          for (let poll = 0; poll < 20; poll++) {
            await new Promise(r => setTimeout(r, 1500));
            const curUrl = await taskWin.webContents.executeJavaScript('window.location.href');
            if (!curUrl.includes('payment_cash_verify') && !curUrl.includes('payment_verify')) {
              console.log('[freemans-run] Payment processed — redirected to:', curUrl);
              verifyDone = true;
              break;
            }
            progress(4, `Processing payment...`, 85 + Math.min(poll, 10));
          }
          if (!verifyDone) {
            console.log('[freemans-run] Payment verification timed out after 30s');
          }
          pagesVisited--; // Don't count against page limit
          break;
        }

        case 'order_complete': {
          progress(5, 'Order placed!', 100);
          orderPlaced = true;
          const orderInfo = await taskWin.webContents.executeJavaScript(`
            (function() {
              var text = document.body.innerText || document.body.textContent;
              // Try multiple patterns for order number (must be 4+ chars, alphanumeric with optional dashes)
              var patterns = [
                /order\\s*(?:number|no\\.?|ref(?:erence)?|#)\\s*[:\\s]+\\s*([A-Z0-9][A-Z0-9-]{3,})/i,
                /(?:your|the)\\s+order\\s+(?:is\\s+)?([A-Z0-9][A-Z0-9-]{3,})/i,
                /confirmation\\s*(?:number|#|no\\.?)\\s*[:\\s]+\\s*([A-Z0-9][A-Z0-9-]{3,})/i
              ];
              for (var i = 0; i < patterns.length; i++) {
                var m = text.match(patterns[i]);
                if (m && m[1].length >= 4) return m[1];
              }
              return null;
            })()
          `);
          console.log('[freemans-run] Order complete! Order number:', orderInfo);
          result.orderNumber = orderInfo;
          result.checkoutComplete = true;
          break;
        }

        case 'login': {
          // Back on login — credentials failed
          taskWin.close();
          return { ...result, checkoutReady: false, checkoutError: 'Login failed — check email/password in profile', checkoutStep: 'login' };
        }

        case 'captcha': {
          const captchaType = await detectCaptcha(taskWin);
          progress(0, 'Captcha detected!', 0);
          console.log('[freemans-run] Captcha detected:', captchaType || 'unknown');
          taskWin.close();
          return {
            ...result,
            checkoutReady: false,
            checkoutError: `Captcha detected (${captchaType || 'verification'}) — try again or use debug mode`,
            checkoutStep: 'captcha'
          };
        }

        default: {
          // Check for captcha before trying to continue
          const captchaType = await detectCaptcha(taskWin);
          if (captchaType) {
            console.log('[freemans-run] Captcha detected on unknown page:', captchaType);
            progress(0, 'Captcha detected!', 0);
            taskWin.close();
            return {
              ...result,
              checkoutReady: false,
              checkoutError: `Captcha detected (${captchaType}) — try again or use debug mode`,
              checkoutStep: 'captcha'
            };
          }
          // Unknown page — try clicking continue
          const clicked = await clickContinueButton(taskWin);
          if (!clicked.clicked) {
            const unknownUrl = await taskWin.webContents.executeJavaScript('window.location.href');
            taskWin.close();
            return { ...result, checkoutReady: false, checkoutError: 'Unknown checkout page: ' + unknownUrl, checkoutStep: 'unknown' };
          }
          await waitForPageReady(taskWin, 2000);
          break;
        }
      }
    }

    taskWin.close();

    if (orderPlaced) {
      return { ...result, checkoutReady: true, checkoutComplete: true, checkoutMode: profile.existingAccount ? 'login' : 'register' };
    } else {
      return { ...result, checkoutReady: false, checkoutError: 'Checkout loop ended without placing order (' + pagesVisited + ' pages visited)', checkoutStep: 'loop_limit' };
    }

  } catch (err) {
    console.error('[freemans-run] Error:', err.message, err.stack);
    try { taskWin.close(); } catch (e) {}
    // Log error persistently
    const errLog = store.get('errorLog') || [];
    errLog.unshift({ id: Date.now().toString(36), timestamp: Date.now(), level: 'error', message: err.message, module: 'freemans', taskId, step: 'checkout', stack: err.stack ? err.stack.substring(0, 500) : null });
    if (errLog.length > 500) errLog.length = 500;
    store.set('errorLog', errLog);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('open-checkout', () => {
  require('electron').shell.openExternal('https://www.freemans.com/web/main/co_login.asp');
});

// ============================================================
// VERY MODULE — IPC Handlers
// ============================================================

ipcMain.handle('very-run', async (event, { cartLink, taskId, profile, deliveryMethod, paymentMethod, ccPostcode, ccStoreName, promoCode, dryRun, atcOnly }) => {
  console.log('[very-run] Starting task:', taskId, '| Link:', cartLink?.substring(0, 60), '| Delivery:', deliveryMethod, '| Payment:', paymentMethod, atcOnly ? '| ATC ONLY' : '');

  if (!extensionSocket || extensionSocket.readyState !== 1) {
    return { success: false, error: 'Chrome extension not connected. Make sure Murphy AIO extension is installed and Chrome is running.' };
  }

  if (!cartLink) {
    return { success: false, error: 'No cart link provided' };
  }

  if (!profile) {
    return { success: false, error: 'No profile selected (email/password/postcode required)' };
  }

  // Build the config to send to the extension's content script
  const config = {
    cartLink,
    email: profile.email || '',
    password: profile.password || '',
    postcode: profile.postcode || profile.shipPostcode || '',
    ccv: profile.cvv || '',
    deliveryMethod: deliveryMethod || 'standard',
    paymentMethod: paymentMethod || 'card',
    ccPostcode: ccPostcode || profile.postcode || profile.shipPostcode || '',
    ccStoreName: ccStoreName || '',
    promoCode: promoCode || '',
    dryRun: dryRun || false,
    atcOnly: atcOnly || false
  };

  // Send progress
  sendProgress(taskId, 1, dryRun ? 'Trial run — opening cart link...' : 'Opening cart link...', 5);

  return new Promise((resolve) => {
    // 6 minutes for 3DS wait, 3 minutes for normal/dry-run
    const timeoutMs = 360000;
    const timeout = setTimeout(() => {
      veryPendingTasks.delete(taskId);
      resolve({ success: false, error: `Checkout timed out after ${timeoutMs / 60000} minutes` });
    }, timeoutMs);

    veryPendingTasks.set(taskId, { resolve, timeout });

    // Tell the extension to start the task
    const sent = sendToExtension({
      type: 'very-start-task',
      taskId,
      config
    });

    if (!sent) {
      clearTimeout(timeout);
      veryPendingTasks.delete(taskId);
      resolve({ success: false, error: 'Failed to send command to extension' });
    }
  });
});

ipcMain.handle('very-stop', async (event, { taskId }) => {
  sendToExtension({ type: 'very-stop-task', taskId });
  const pending = veryPendingTasks.get(taskId);
  if (pending) {
    clearTimeout(pending.timeout);
    veryPendingTasks.delete(taskId);
    pending.resolve({ success: false, error: 'Stopped by user' });
  }
  return { success: true };
});

ipcMain.handle('get-extension-status', () => {
  return { connected: extensionSocket && extensionSocket.readyState === 1 };
});

// --- Very saved links management ---
ipcMain.handle('get-very-links', () => {
  return store.get('veryLinks') || [];
});

ipcMain.handle('save-very-link', (event, link) => {
  const links = store.get('veryLinks') || [];
  const idx = links.findIndex(l => l.id === link.id);
  if (idx >= 0) links[idx] = link;
  else links.push(link);
  store.set('veryLinks', links);
  return { success: true, links };
});

ipcMain.handle('delete-very-link', (event, id) => {
  const links = (store.get('veryLinks') || []).filter(l => l.id !== id);
  store.set('veryLinks', links);
  return { success: true, links };
});

// --- Very link groups management ---
ipcMain.handle('get-very-link-groups', () => {
  return store.get('veryLinkGroups') || [];
});

ipcMain.handle('save-very-link-group', (event, group) => {
  const groups = store.get('veryLinkGroups') || [];
  const idx = groups.findIndex(g => g.id === group.id);
  if (idx >= 0) groups[idx] = group;
  else groups.push(group);
  store.set('veryLinkGroups', groups);
  return { success: true, groups };
});

ipcMain.handle('delete-very-link-group', (event, id) => {
  let groups = (store.get('veryLinkGroups') || []).filter(g => g.id !== id);
  store.set('veryLinkGroups', groups);
  // Also delete links belonging to this group
  const links = (store.get('veryLinks') || []).filter(l => l.groupId !== id);
  store.set('veryLinks', links);
  return { success: true, groups };
});

// --- IPC: Custom sounds ---
ipcMain.handle('get-sound-files', () => {
  const soundsDir = path.join(app.getPath('userData'), 'sounds');
  try {
    if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
    return fs.readdirSync(soundsDir).filter(f => /\.(mp3|wav|ogg|m4a)$/i.test(f));
  } catch (e) { return []; }
});

ipcMain.handle('get-sounds-folder', () => {
  const soundsDir = path.join(app.getPath('userData'), 'sounds');
  if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
  return soundsDir;
});

ipcMain.handle('open-sounds-folder', () => {
  const soundsDir = path.join(app.getPath('userData'), 'sounds');
  if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });
  shell.openPath(soundsDir);
  return { success: true };
});

// --- IPC: Stats ---
ipcMain.handle('get-stats', () => {
  return store.get('stats') || { tasksRun: 0, itemsAdded: 0, checkouts: 0 };
});

ipcMain.handle('update-stats', (event, updates) => {
  const allZero = Object.values(updates).every(v => v === 0);
  if (allZero) {
    store.set('stats', { tasksRun: 0, itemsAdded: 0, checkouts: 0 });
    return store.get('stats');
  }
  const stats = store.get('stats') || { tasksRun: 0, itemsAdded: 0, checkouts: 0 };
  Object.keys(updates).forEach(k => { stats[k] = (stats[k] || 0) + updates[k]; });
  store.set('stats', stats);
  return stats;
});

// --- IPC: Settings ---
const DEFAULT_SETTINGS = {
  notificationSound: true,
  defaultQuantity: 20,
  autoStartTasks: false,
  taskDelay: 300,
  webhookUrl: '',
  autoClearCompleted: false,
  debugMode: false,
  maxConcurrentTasks: 3,
  maxRetries: 3,
  retryDelay: 5000,
  desktopNotifications: true,
  proxyEnabled: false,
  proxies: [],
  proxyRotationIndex: 0,
  proxyGroups: [],
  defaultProxyGroup: null,
  avatar: 'default',
  accentColour: 'green',
  username: ''
};

ipcMain.handle('get-settings', () => {
  return Object.assign({}, DEFAULT_SETTINGS, store.get('settings') || {});
});

ipcMain.handle('save-settings', (event, settings) => {
  store.set('settings', settings);
  return { success: true };
});

// --- IPC: Persistent Error Log ---
ipcMain.handle('get-error-log', () => {
  return store.get('errorLog') || [];
});

ipcMain.handle('log-error', (event, entry) => {
  const log = store.get('errorLog') || [];
  log.unshift({
    id: entry.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
    timestamp: entry.timestamp || Date.now(),
    level: entry.level || 'error',
    message: entry.message || 'Unknown error',
    module: entry.module || 'system',
    taskId: entry.taskId || null,
    productCode: entry.productCode || null,
    step: entry.step || null,
    stack: entry.stack || null
  });
  if (log.length > 500) log.length = 500;
  store.set('errorLog', log);
  return { success: true };
});

ipcMain.handle('clear-error-log', () => {
  store.set('errorLog', []);
  return { success: true };
});

// --- IPC: Supabase checkout logging ---
ipcMain.handle('log-checkout', async (event, data) => {
  // Fire-and-forget — don't block the renderer
  logCheckoutToSupabase(data);
  logCheckoutLocally(data);
  return { success: true };
});

ipcMain.handle('get-checkout-log', () => {
  return store.get('checkoutLog') || [];
});

ipcMain.handle('clear-checkout-log', () => {
  store.set('checkoutLog', []);
  return { success: true };
});

// --- IPC: Export / Import all data ---
ipcMain.handle('export-all-data', () => {
  return {
    version: '1.9.1',
    timestamp: new Date().toISOString(),
    settings: store.get('settings') || {},
    profiles: store.get('profiles') || [],
    tasks: store.get('tasks') || [],
    stats: store.get('stats') || {},
    stockMonitors: store.get('stockMonitors') || [],
    taskGroups: store.get('taskGroups') || [],
    checkoutLog: store.get('checkoutLog') || [],
    errorLog: store.get('errorLog') || []
  };
});

ipcMain.handle('import-all-data', (event, data) => {
  try {
    const counts = {};
    if (data.settings && typeof data.settings === 'object') {
      store.set('settings', data.settings);
      counts.settings = 1;
    }
    if (Array.isArray(data.profiles)) {
      store.set('profiles', data.profiles);
      counts.profiles = data.profiles.length;
    }
    if (Array.isArray(data.tasks)) {
      store.set('tasks', data.tasks);
      counts.tasks = data.tasks.length;
    }
    if (data.stats && typeof data.stats === 'object') {
      store.set('stats', data.stats);
      counts.stats = 1;
    }
    if (Array.isArray(data.stockMonitors)) {
      store.set('stockMonitors', data.stockMonitors);
      counts.stockMonitors = data.stockMonitors.length;
    }
    if (Array.isArray(data.taskGroups)) {
      store.set('taskGroups', data.taskGroups);
      counts.taskGroups = data.taskGroups.length;
    }
    if (Array.isArray(data.checkoutLog)) {
      store.set('checkoutLog', data.checkoutLog);
      counts.checkoutLog = data.checkoutLog.length;
    }
    if (Array.isArray(data.errorLog)) {
      store.set('errorLog', data.errorLog);
      counts.errorLog = data.errorLog.length;
    }
    return { success: true, counts };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC: Stock monitor CRUD ---
ipcMain.handle('get-stock-monitors', () => {
  return store.get('stockMonitors') || [];
});

ipcMain.handle('save-stock-monitor', (event, monitor) => {
  const monitors = store.get('stockMonitors') || [];
  const idx = monitors.findIndex(m => m.id === monitor.id);
  if (idx >= 0) monitors[idx] = monitor;
  else monitors.push(monitor);
  store.set('stockMonitors', monitors);
  return { success: true, monitors };
});

ipcMain.handle('delete-stock-monitor', (event, id) => {
  let monitors = store.get('stockMonitors') || [];
  monitors = monitors.filter(m => m.id !== id);
  store.set('stockMonitors', monitors);
  return { success: true, monitors };
});

ipcMain.handle('check-stock', async (event, { url }) => {
  const checkSettings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings') || {});
  const checkWin = new BrowserWindow({
    width: 800, height: 600, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: 'persist:freemans' }
  });
  try {
    const stockProxy = getNextProxy(checkSettings);
    if (stockProxy) {
      await checkWin.webContents.session.setProxy({ proxyRules: stockProxy });
      console.log('[check-stock] Using proxy:', stockProxy);
    }
    await checkWin.loadURL(url);
    await waitForPageReady(checkWin, 500);
    const result = await checkWin.webContents.executeJavaScript(`
      (function() {
        var btn = document.querySelector('.addToBag, .add-to-bag, #addToBagBtn, [data-action="addToBag"]');
        var outText = (document.body.innerText || '').toLowerCase();
        var outOfStock = outText.includes('out of stock') || outText.includes('sold out') || outText.includes('currently unavailable');
        var m = window.location.href.match(/\\/A-([^\\/\\?]+)/);
        return {
          inStock: btn !== null && !outOfStock,
          productCode: m ? m[1] : null
        };
      })()
    `);
    checkWin.close();
    return result;
  } catch (e) {
    try { checkWin.close(); } catch (_) {}
    return { inStock: false, error: e.message };
  }
});

// --- IPC: Task groups CRUD ---
ipcMain.handle('get-task-groups', () => {
  return store.get('taskGroups') || [];
});

ipcMain.handle('save-task-group', (event, group) => {
  const groups = store.get('taskGroups') || [];
  const idx = groups.findIndex(g => g.id === group.id);
  if (idx >= 0) groups[idx] = group;
  else groups.push(group);
  store.set('taskGroups', groups);
  return { success: true, groups };
});

ipcMain.handle('delete-task-group', (event, id) => {
  let groups = store.get('taskGroups') || [];
  groups = groups.filter(g => g.id !== id);
  store.set('taskGroups', groups);
  return { success: true, groups };
});

// --- IPC: Desktop notifications ---
ipcMain.handle('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notif = new Notification({ title, body });
    notif.show();
  }
});

// --- IPC: Clear session cookies ---
ipcMain.handle('clear-cookies', async (event, partition) => {
  try {
    const ses = session.fromPartition(partition || 'persist:freemans');
    await ses.clearStorageData();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC: Webhook relay (avoids CORS from renderer) ---
ipcMain.handle('send-webhook', async (event, { url, payload }) => {
  try {
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { success: response.ok };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- IPC: Test webhook ---
ipcMain.handle('test-webhook', async (event, url) => {
  if (!url) return { success: false, error: 'No URL provided' };
  try {
    const payload = {
      embeds: [{
        title: 'Webhook Connected',
        description: 'Murph AIO is connected and ready to send notifications.',
        color: 0x00b894,
        fields: [
          { name: 'Status', value: 'Active', inline: true },
          { name: 'Module', value: 'Freemans', inline: true }
        ],
        footer: { text: 'Murph AIO \u2022 Test' },
        timestamp: new Date().toISOString()
      }]
    };
    const response = await net.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { success: response.ok, status: response.status };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// --- Proxy rotation helper ---
function parseProxy(proxyStr) {
  if (!proxyStr || !proxyStr.trim()) return null;
  let str = proxyStr.trim();
  // Already has protocol
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('socks5://') || str.startsWith('socks4://')) {
    return str;
  }
  // user:pass@host:port
  if (str.includes('@')) {
    return 'http://' + str;
  }
  // host:port
  return 'http://' + str;
}

function getNextProxy(settings, groupId) {
  if (!settings.proxyEnabled) return null;

  // Try proxy groups system first
  const groups = settings.proxyGroups || [];
  const targetId = groupId || settings.defaultProxyGroup;
  const group = targetId ? groups.find(g => g.id === targetId) : null;

  if (group && group.proxies && group.proxies.length > 0) {
    const idx = (group.rotationIndex || 0) % group.proxies.length;
    const proxy = parseProxy(group.proxies[idx]);
    group.rotationIndex = (idx + 1) % group.proxies.length;
    store.set('settings', settings);
    return proxy;
  }

  // Fallback to legacy flat proxy list
  if (settings.proxies && settings.proxies.length > 0) {
    const idx = (settings.proxyRotationIndex || 0) % settings.proxies.length;
    const proxy = parseProxy(settings.proxies[idx]);
    settings.proxyRotationIndex = (idx + 1) % settings.proxies.length;
    store.set('settings', settings);
    return proxy;
  }

  return null;
}

// --- IPC: Test proxy ---
ipcMain.handle('test-proxy', async (event, proxyStr) => {
  if (!proxyStr) return { success: false, error: 'No proxy provided' };
  const proxy = parseProxy(proxyStr);
  if (!proxy) return { success: false, error: 'Invalid proxy format' };
  const testWin = new BrowserWindow({
    width: 400, height: 300, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  try {
    await testWin.webContents.session.setProxy({ proxyRules: proxy });
    await testWin.loadURL('https://httpbin.org/ip');
    const body = await testWin.webContents.executeJavaScript('document.body.innerText');
    testWin.close();
    const data = JSON.parse(body);
    return { success: true, ip: data.origin || 'Unknown' };
  } catch (e) {
    try { testWin.close(); } catch (_) {}
    return { success: false, error: e.message };
  }
});

// --- IPC: Proxy groups ---
ipcMain.handle('get-proxy-groups', () => {
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings') || {});
  return settings.proxyGroups || [];
});

ipcMain.handle('save-proxy-group', (event, group) => {
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings') || {});
  if (!settings.proxyGroups) settings.proxyGroups = [];
  const idx = settings.proxyGroups.findIndex(g => g.id === group.id);
  if (idx >= 0) settings.proxyGroups[idx] = group;
  else settings.proxyGroups.push(group);
  store.set('settings', settings);
  return { success: true };
});

ipcMain.handle('delete-proxy-group', (event, id) => {
  const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings') || {});
  settings.proxyGroups = (settings.proxyGroups || []).filter(g => g.id !== id);
  if (settings.defaultProxyGroup === id) settings.defaultProxyGroup = null;
  store.set('settings', settings);
  return { success: true };
});

// --- One-time migration: flat proxies -> proxy group ---
(function migrateProxyData() {
  const settings = store.get('settings');
  if (!settings) return;
  if (settings.proxies && settings.proxies.length > 0 && (!settings.proxyGroups || settings.proxyGroups.length === 0)) {
    console.log('[migration] Converting flat proxy list to proxy group');
    settings.proxyGroups = [{
      id: 'migrated-' + Date.now().toString(36),
      name: 'Imported Proxies',
      proxies: [...settings.proxies],
      rotationIndex: settings.proxyRotationIndex || 0
    }];
    settings.defaultProxyGroup = settings.proxyGroups[0].id;
    store.set('settings', settings);
  }
})();

// ============================================================
// AUTO-UPDATER (electron-updater + GitHub Releases)
// ============================================================
autoUpdater.autoDownload = false;
autoUpdater.logger = { info: (...a) => console.log('[updater]', ...a), warn: (...a) => console.warn('[updater]', ...a), error: (...a) => console.error('[updater]', ...a) };

autoUpdater.on('update-available', (info) => {
  console.log('[updater] Update available:', info.version);
  if (mainWindow) mainWindow.webContents.send('update-available', { version: info.version });
});

autoUpdater.on('update-not-available', () => {
  console.log('[updater] App is up to date');
});

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) mainWindow.webContents.send('update-progress', { percent: Math.round(progress.percent) });
});

autoUpdater.on('update-downloaded', () => {
  console.log('[updater] Update downloaded, ready to install');
  if (mainWindow) mainWindow.webContents.send('update-downloaded');
});

autoUpdater.on('error', (err) => {
  console.error('[updater] Error:', err.message);
});

ipcMain.handle('updater-check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      return { update: true, version: result.updateInfo.version };
    }
    return { update: false };
  } catch (e) {
    console.error('[updater] Manual check failed:', e.message);
    return { update: false, error: e.message };
  }
});

ipcMain.handle('updater-download', () => {
  autoUpdater.downloadUpdate();
  return { ok: true };
});

ipcMain.handle('updater-install', () => {
  autoUpdater.quitAndInstall(false, true);
  return { ok: true };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// ============================================================
// Extension Bundling — sync bundled extension to user data dir
// ============================================================

function getExtensionPaths() {
  const bundledPath = app.isPackaged
    ? path.join(process.resourcesPath, 'extension')
    : path.join(__dirname, '..', 'extension');
  const userPath = path.join(app.getPath('userData'), 'murph-extension');
  return { bundledPath, userPath };
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function syncExtension() {
  const { bundledPath, userPath } = getExtensionPaths();

  if (!fs.existsSync(bundledPath)) {
    console.log('[extension] No bundled extension found at:', bundledPath);
    return;
  }

  // Check if sync is needed by comparing manifest versions
  let needsSync = true;
  try {
    const bundledManifest = JSON.parse(fs.readFileSync(path.join(bundledPath, 'manifest.json'), 'utf8'));
    const userManifestPath = path.join(userPath, 'manifest.json');
    if (fs.existsSync(userManifestPath)) {
      const userManifest = JSON.parse(fs.readFileSync(userManifestPath, 'utf8'));
      if (userManifest.version === bundledManifest.version) {
        needsSync = false;
        console.log('[extension] Extension already up to date (v' + userManifest.version + ')');
      }
    }
  } catch (e) {
    // If any error reading manifests, force sync
    needsSync = true;
  }

  if (needsSync) {
    console.log('[extension] Syncing extension to:', userPath);
    try {
      // Remove old version if it exists
      if (fs.existsSync(userPath)) {
        fs.rmSync(userPath, { recursive: true, force: true });
      }
      copyDirSync(bundledPath, userPath);
      console.log('[extension] Extension synced successfully');
    } catch (e) {
      console.error('[extension] Sync failed:', e.message);
    }
  }
}

ipcMain.handle('get-extension-path', () => {
  const { userPath } = getExtensionPaths();
  return fs.existsSync(userPath) ? userPath : null;
});

ipcMain.handle('open-chrome-with-extension', async () => {
  const { userPath } = getExtensionPaths();
  if (!fs.existsSync(userPath)) {
    return { success: false, error: 'Extension not found' };
  }

  const { exec } = require('child_process');
  const chromeProfilePath = path.join(app.getPath('userData'), 'murph-chrome-profile');

  let chromeCmd;
  if (process.platform === 'darwin') {
    chromeCmd = `open -na "Google Chrome" --args --load-extension="${userPath}" --user-data-dir="${chromeProfilePath}"`;
  } else if (process.platform === 'win32') {
    // Check common Chrome install paths on Windows
    const chromePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    const chromePath = chromePaths.find(p => fs.existsSync(p));
    if (!chromePath) {
      return { success: false, error: 'Chrome not found. Install Google Chrome and try again.' };
    }
    chromeCmd = `"${chromePath}" --load-extension="${userPath}" --user-data-dir="${chromeProfilePath}"`;
  } else {
    chromeCmd = `google-chrome --load-extension="${userPath}" --user-data-dir="${chromeProfilePath}"`;
  }

  return new Promise((resolve) => {
    exec(chromeCmd, (err) => {
      if (err) {
        console.error('[extension] Failed to open Chrome:', err.message);
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true });
      }
    });
  });
});

app.whenReady().then(() => {
  syncExtension();
  createWindow();
  startWebSocketServer();
  // Check for updates 3 seconds after launch (skip in dev)
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(e => console.error('[updater] Check failed:', e.message));
    }, 3000);
  }
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
