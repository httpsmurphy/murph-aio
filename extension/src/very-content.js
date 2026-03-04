// Murphy AIO — Very Auto-Checkout Content Script v1.0
// Runs on very.co.uk pages, receives commands from Electron app via background script
(function () {
  'use strict';

  const TAG = '[MURPH-VERY]';
  console.log(`${TAG} Content script loaded | URL: ${window.location.href}`);

  // Session expired detection: if Very shows "session expired" on the login page
  // (common after opening a Stellar link), we auto-refresh before attempting login.
  // After refresh the login form works fine on the second load.

  // ============================================================
  // HUMAN-LIKE HELPERS (anti-detection)
  // ============================================================

  function randomDelay(min = 80, max = 250) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
  }

  // Chrome autofill detection — .value can be empty even when the field looks filled
  function isAutofilled(el) {
    if (!el) return false;
    // Method 1: Chrome's autofill pseudo-class
    try { if (el.matches(':-webkit-autofill')) return true; } catch (e) {}
    // Method 2: Check if value is non-empty
    if (el.value && el.value.trim() !== '') return true;
    // Method 3: Check computed background color (Chrome tints autofilled fields yellow)
    try {
      const bg = window.getComputedStyle(el).backgroundColor;
      // Chrome autofill sets background to rgb(232, 240, 254) or similar light blue/yellow
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)' && bg !== 'transparent') {
        // Non-default background — likely autofilled
        return true;
      }
    } catch (e) {}
    return false;
  }

  function humanType(el, text, opts = {}) {
    return new Promise(async (resolve) => {
      el.focus();
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      await randomDelay(50, 120);

      // Clear existing value
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await randomDelay(30, 80);

      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        el.value += char;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        // Human typing speed variance (fast but not instant)
        await randomDelay(opts.fast ? 10 : 25, opts.fast ? 30 : 70);
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      resolve();
    });
  }

  function humanClick(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2 + (Math.random() * 4 - 2);
    const y = rect.top + rect.height / 2 + (Math.random() * 4 - 2);

    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    return true;
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }

  function waitForNavigation(urlPattern, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (window.location.href.includes(urlPattern)) return resolve();

      const check = setInterval(() => {
        if (window.location.href.includes(urlPattern)) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 300);

      const timer = setTimeout(() => {
        clearInterval(check);
        reject(new Error(`Timeout waiting for navigation to ${urlPattern}`));
      }, timeout);
    });
  }

  // Wait for ANY of the given selectors to appear (polls fast, no blind waits)
  function waitForAny(selectors, timeout = 10000) {
    return new Promise((resolve, reject) => {
      // Check immediately
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return resolve(el);
      }
      // Watch for DOM changes
      const allSel = selectors.join(', ');
      const observer = new MutationObserver(() => {
        const el = document.querySelector(allSel);
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for: ${selectors.join(' | ')}`));
      }, timeout);
    });
  }

  // ============================================================
  // PAGE DETECTION
  // ============================================================

  function detectPage() {
    const url = window.location.href;
    if (url.includes('/account/login') || url.includes('/account/checkout-login')) return 'login';
    if (url.includes('/basket')) return 'basket';
    if (url.includes('/checkout/delivery/click-and-collect')) return 'click-and-collect';
    if (url.includes('/checkout/delivery')) return 'delivery';
    if (url.includes('/checkout/payment/card')) return 'ccv';
    if (url.includes('/checkout/payment')) return 'payment';
    if (url.includes('/checkout/confirmation')) return 'confirmation';
    if (url.includes('/home.page') || url === 'https://www.very.co.uk/' || url === 'https://very.co.uk/') return 'home';
    return 'unknown';
  }

  // Detect Very's "technical difficulties" / error splash pages
  function isTechnicalErrorPage() {
    const text = (document.body?.textContent || '').toLowerCase();
    const phrases = [
      'technical difficulties',
      'technical error',
      'something went wrong',
      'service unavailable',
      'server error',
      'unexpected error',
      'please try again later',
      'we\'re experiencing',
      'we are experiencing',
      'try again shortly'
    ];
    return phrases.some(p => text.includes(p));
  }

  // ============================================================
  // SMART BUTTON FINDER (tries multiple strategies)
  // ============================================================

  async function findButton(opts = {}) {
    const { testIds = [], textPatterns = [], hrefPattern, fallbackText, waitMs = 8000 } = opts;

    // Strategy 1: data-testid selectors
    for (const sel of testIds) {
      const el = document.querySelector(sel);
      if (el) { console.log(`${TAG} Found btn via testid: ${sel}`); return el; }
    }

    // Strategy 2: button/link text content match
    if (textPatterns.length > 0) {
      const allClickable = Array.from(document.querySelectorAll('button, a'));
      const regex = new RegExp(textPatterns.join('|'), 'i');
      const el = allClickable.find(b => regex.test(b.textContent));
      if (el) { console.log(`${TAG} Found btn by text: "${el.textContent.trim().substring(0, 40)}"`); return el; }
    }

    // Strategy 3: href match
    if (hrefPattern) {
      const el = document.querySelector(`a[href*="${hrefPattern}"]`);
      if (el) { console.log(`${TAG} Found btn by href: ${hrefPattern}`); return el; }
    }

    // Strategy 4: Wait with MutationObserver
    console.log(`${TAG} Button not found yet, waiting up to ${waitMs}ms...`);
    try {
      // Build a combined selector from testIds
      const waitSel = testIds.filter(s => s.includes('*')).concat(
        hrefPattern ? [`a[href*="${hrefPattern}"]`] : []
      ).join(', ') || '[data-testid*="continue"], [data-testid*="checkout"], button[type="submit"]';
      const el = await waitForElement(waitSel, waitMs);
      if (el) { console.log(`${TAG} Found btn after waiting`); return el; }
    } catch (e) { /* timeout */ }

    // Strategy 5: Last resort — any button matching fallback text
    if (fallbackText) {
      const regex = new RegExp(fallbackText, 'i');
      const el = Array.from(document.querySelectorAll('button, a')).find(b => regex.test(b.textContent));
      if (el) { console.log(`${TAG} Found btn by fallback text: "${el.textContent.trim().substring(0, 40)}"`); return el; }
    }

    return null;
  }

  // ============================================================
  // STEP HANDLERS
  // ============================================================

  // Set by early session check or handleLogin — prevents duplicate reload attempts
  let _earlyReloadFired = false;

  // ── SESSION EXPIRED DETECTION (multi-layer, catches it no matter what) ──

  function checkLoginErrors() {
    // Only check if we're actually on the login page still
    if (!window.location.href.includes('/account/login')) return null;

    // Layer 1: data-testid selectors (most specific)
    const errorBanner = document.querySelector('[data-testid="login-error-message"]');
    if (errorBanner) {
      const text = (errorBanner.textContent || '').trim().toLowerCase();
      // Skip empty/hidden banners (React keeps them in DOM)
      if (!text) { console.log(`${TAG} [DETECT-L1] error banner exists but empty — ignoring`); }
      else {
        console.log(`${TAG} [DETECT-L1] error banner: "${text.substring(0, 100)}"`);
        if (text.includes('session') || text.includes('expired') || text.includes('refresh')) return 'expired';
        if (text.includes('failed') || text.includes('rate') || text.includes('too many')) return 'rate-limit';
      }
    }

    // Layer 2: fuse-alert component (Very's shared alert component)
    const fuseAlert = document.querySelector('[data-testid*="fuse-alert"]');
    if (fuseAlert) {
      const text = (fuseAlert.textContent || '').trim().toLowerCase();
      if (text) {
        console.log(`${TAG} [DETECT-L2] fuse-alert: "${text.substring(0, 100)}"`);
        if (text.includes('session') || text.includes('expired')) return 'expired';
        if (text.includes('rate') || text.includes('too many')) return 'rate-limit';
      }
    }

    // Layer 3: role="alert" elements with session-related text
    for (const el of document.querySelectorAll('[role="alert"]')) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text && (text.includes('session') || text.includes('expired')) && text.includes('refresh')) {
        console.log(`${TAG} [DETECT-L3] role=alert: "${text.substring(0, 100)}"`);
        return 'expired';
      }
    }

    // Layer 4: Visible text containing specific session expired phrases
    const visibleText = (document.body?.innerText || '').toLowerCase();
    if (visibleText.includes('session has expired') ||
        visibleText.includes('your session has expired') ||
        visibleText.includes('session expired')) {
      console.log(`${TAG} [DETECT-L4] Found in visible page text`);
      return 'expired';
    }

    return null;
  }

  async function handleLogin(config) {
    console.log(`${TAG} Handling login page`);
    sendStatus('login', 'Logging in...');

    // If the early watcher already fired a reload, bail out
    if (_earlyReloadFired) return { action: 'wait-reload' };

    // Wait for any Discord username overlay (from very_tracker.js) to clear
    const overlayGone = () => !document.getElementById('aco-discord-overlay');
    if (!overlayGone()) {
      sendStatus('login', 'Waiting for Discord overlay...');
      const start = Date.now();
      while (!overlayGone() && Date.now() - start < 30000) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Wait for email input to appear (no blind wait — scan for it)
    let emailInput;
    try {
      emailInput = await waitForAny(['input[name="emailOrAccountNo"]', 'input[type="email"]'], 8000);
    } catch (e) {
      throw new Error('Email input not found');
    }

    // ── CHECK FOR SESSION EXPIRED / ERRORS BEFORE FILLING ──
    const loginError = checkLoginErrors();
    if (loginError === 'expired') {
      console.log(`${TAG} Session expired detected before login — refreshing`);
      sendStatus('login', 'Session expired — refreshing...');
      _earlyReloadFired = true;
      window.location.reload();
      return { action: 'wait-reload' };
    }
    if (loginError === 'rate-limit') {
      console.log(`${TAG} Rate limit detected before login — waiting then refreshing`);
      sendStatus('login', 'Rate limited — waiting 5s...');
      _earlyReloadFired = true;
      await randomDelay(5000, 7000);
      window.location.reload();
      return { action: 'wait-reload' };
    }

    // ── FILL CREDENTIALS ──

    // Check if "Remember my email" is ticked — if so, Very has genuinely saved the email
    let rememberCheckbox = document.querySelector('input[type="checkbox"][name*="remember" i], input[type="checkbox"][id*="remember" i]');
    if (!rememberCheckbox) {
      const labels = Array.from(document.querySelectorAll('label'));
      const rememberLabel = labels.find(l => /remember my email/i.test(l.textContent));
      if (rememberLabel) rememberCheckbox = rememberLabel.querySelector('input[type="checkbox"]');
    }
    const isRemembered = rememberCheckbox && rememberCheckbox.checked;

    if (isRemembered && emailInput.value && emailInput.value.trim() !== '') {
      console.log(`${TAG} Email remembered by Very, skipping`);
    } else {
      await humanType(emailInput, config.email);
    }

    // Fill password — ALWAYS type
    const passInput = document.querySelector('input[name="password"]');
    if (!passInput) throw new Error('Password input not found');
    await humanType(passInput, config.password);

    // Fill postcode — skip if Very remembered it
    const postInput = document.querySelector('input[name="postcode"]');
    if (!postInput) throw new Error('Postcode input not found');
    if (isRemembered && postInput.value && postInput.value.trim() !== '') {
      console.log(`${TAG} Postcode remembered by Very, skipping`);
    } else {
      await humanType(postInput, config.postcode);
    }

    // Tick "Remember my email" if unticked (so next login is faster)
    if (rememberCheckbox && !rememberCheckbox.checked) {
      humanClick(rememberCheckbox);
      await randomDelay(80, 150);
    }

    // Small human-like pause before clicking sign in
    await randomDelay(100, 250);

    // Click sign in
    const allSubmits = Array.from(document.querySelectorAll('button[type="submit"]'));
    const signInBtn = allSubmits.find(b => /sign in/i.test(b.textContent));
    if (!signInBtn) throw new Error('Sign in button not found');
    humanClick(signInBtn);

    sendStatus('login', 'Credentials submitted...');

    // Poll for result: either we navigate away (success) or an error appears
    const loginStart = Date.now();
    while (Date.now() - loginStart < 8000) {
      await new Promise(r => setTimeout(r, 300));
      // If we've left the login page, success
      if (!window.location.href.includes('/account/login') && !window.location.href.includes('/account/checkout-login')) {
        console.log(`${TAG} Login succeeded — navigated away`);
        return { action: 'wait-navigation' };
      }
      // Check for errors
      const postError = checkLoginErrors();
      if (postError === 'expired') {
        console.log(`${TAG} Session expired after submit — refreshing`);
        sendStatus('login', 'Session expired — refreshing...');
        window.location.reload();
        return { action: 'wait-reload' };
      }
    }

    return { action: 'wait-navigation' };
  }

  async function handleBasket(config) {
    console.log(`${TAG} Handling basket page | atcOnly=${config?.atcOnly}`);
    sendStatus('basket', 'Checking basket...');

    // Poll for either: login redirect, basket content, or checkout button (no blind wait)
    const basketStart = Date.now();
    while (Date.now() - basketStart < 12000) {
      // Redirected to login? Bail out
      if (window.location.href.includes('/account/login') || window.location.href.includes('/account/checkout-login')) {
        console.log(`${TAG} Redirected to login from basket — bailing out`);
        return { action: 'wait-navigation' };
      }
      if (detectPage() !== 'basket') {
        console.log(`${TAG} No longer on basket page (now: ${detectPage()}) — bailing out`);
        return { action: 'wait-navigation' };
      }
      // Check if basket content has loaded (any product or checkout button visible)
      const hasContent = document.querySelector(
        '[data-testid*="basket-item"], [data-testid*="product"], [data-testid*="checkout"], ' +
        '[class*="basket-item" i], [class*="BasketItem"], a[href*="/checkout"]'
      );
      if (hasContent) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // ── ATC-ONLY MODE ──
    if (config && config.atcOnly) {
      const basketEmpty = (document.body.innerText || '').toLowerCase();
      if (basketEmpty.includes('basket is empty') || basketEmpty.includes('no items')) {
        throw new Error('Basket is empty — item may not have been added');
      }
      console.log(`${TAG} ATC mode — item carted, stopping here`);
      sendStatus('basket', 'Item carted!');
      return { action: 'complete', orderRef: 'ATC' };
    }

    // ── FULL CHECKOUT: find checkout button ──
    sendStatus('basket', 'Proceeding to checkout...');

    let checkoutBtn = document.querySelector(
      '[data-testid="continue-to-checkout-button"], [data-testid="checkout-button"], ' +
      '[data-testid="basket-checkout-button"], [data-testid*="checkout"]'
    );
    if (!checkoutBtn) {
      const allClickable = Array.from(document.querySelectorAll('button, a[href*="checkout"]'));
      checkoutBtn = allClickable.find(el =>
        /checkout securely|proceed to checkout|continue to checkout|go to checkout/i.test(el.textContent)
      );
    }
    if (!checkoutBtn) checkoutBtn = document.querySelector('a[href*="/checkout"]');
    if (!checkoutBtn) {
      // Wait for it to appear (max 8s)
      try {
        checkoutBtn = await waitForAny([
          '[data-testid*="checkout"]', 'a[href*="/checkout"]'
        ], 8000);
      } catch (e) {
        const btns = Array.from(document.querySelectorAll('button, a'));
        checkoutBtn = btns.find(el => /checkout/i.test(el.textContent));
      }
    }
    if (!checkoutBtn) throw new Error('Checkout button not found');

    humanClick(checkoutBtn);
    sendStatus('basket', 'Clicked checkout...');
    return { action: 'wait-navigation' };
  }

  async function handleDelivery(config) {
    console.log(`${TAG} Handling delivery page`);
    sendStatus('delivery', 'Selecting delivery...');

    // Wait for an actual button to appear (not broad selectors that match divs)
    try {
      await waitForAny([
        '[data-testid="continue-to-payment-button"]',
        'button[type="submit"]', 'button'
      ], 8000);
    } catch (e) { /* continue anyway */ }

    // Check for out-of-stock alerts
    const alerts = document.querySelector('[data-testid="delivery-alerts"]');
    if (alerts && alerts.textContent.trim()) {
      const alertText = alerts.textContent.trim();
      if (/out of stock|unavailable|sorry/i.test(alertText)) {
        sendStatus('delivery', 'OUT OF STOCK: ' + alertText);
        return { action: 'error', error: 'Out of stock: ' + alertText };
      }
    }

    const deliveryMethod = (config && config.deliveryMethod) || 'standard';

    if (deliveryMethod === 'click-and-collect') {
      // Check if C&C is already selected (delivery confirmation page after C&C flow)
      const bodyText = document.body.textContent || '';
      const alreadyCC = bodyText.includes('Change click and collect')
        || bodyText.includes('Change Click and Collect')
        || bodyText.includes('click and collect')
        || document.querySelector('[class*="click-and-collect" i], [class*="clickAndCollect" i], [class*="ClickCollect" i]');
      if (alreadyCC) {
        console.log(`${TAG} C&C already selected — just clicking Continue`);
      } else {
        // First time on delivery page — need to select C&C
        const ccBtn = Array.from(document.querySelectorAll('button, a')).find(
          b => /find a location|click.?&.?collect/i.test(b.textContent)
        );
        if (ccBtn) {
          humanClick(ccBtn);
          try { ccBtn.click(); } catch (e) {}
          return { action: 'wait-navigation' };
        }
        // No C&C button and not already C&C — fall through to standard
        sendStatus('delivery', 'C&C not available, using standard');
      }
    }

    if (deliveryMethod === 'nextday') {
      let nextDayRadio = document.querySelector('[data-testid="delivery-option-radio-NEXTDAY"]');
      if (!nextDayRadio) {
        const labels = Array.from(document.querySelectorAll('label, [class*="radio"], [class*="Radio"]'));
        const label = labels.find(l => /next day|next-day|nextday/i.test(l.textContent));
        if (label) nextDayRadio = label.querySelector('input[type="radio"]') || label;
      }
      if (nextDayRadio) {
        humanClick(nextDayRadio);
        await randomDelay(150, 300);
      } else {
        sendStatus('delivery', 'Next day not available, using standard');
      }
    }

    // Find Continue by TEXT first (avoid broad testId selectors matching non-button divs)
    await randomDelay(100, 200);
    let continueBtn = Array.from(document.querySelectorAll('button')).find(
      b => /^continue$/i.test(b.textContent.trim())
    );
    if (!continueBtn) {
      // Broader text search — any button/link containing "continue"
      continueBtn = Array.from(document.querySelectorAll('button, a')).find(
        b => /continue/i.test(b.textContent)
      );
    }
    if (!continueBtn) {
      // Only now fall back to findButton (with SPECIFIC testIds only — no wildcards)
      continueBtn = await findButton({
        testIds: ['[data-testid="continue-to-payment-button"]'],
        textPatterns: ['continue', 'proceed to payment', 'go to payment'],
        fallbackText: 'continue'
      });
    }
    if (!continueBtn) throw new Error('Continue button not found on delivery page');

    console.log(`${TAG} Delivery continue btn found:`, continueBtn.tagName, continueBtn.className, continueBtn.textContent.trim().substring(0, 30));
    humanClick(continueBtn);
    await randomDelay(50, 100);
    try { continueBtn.click(); } catch (e) {}
    await randomDelay(100, 200);
    // Focus + Enter fallback for React buttons
    try {
      continueBtn.focus();
      continueBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      continueBtn.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      continueBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}
    try {
      const reactKey = Object.keys(continueBtn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
      if (reactKey && continueBtn[reactKey] && continueBtn[reactKey].onClick) {
        console.log(`${TAG} Triggering React onClick directly`);
        continueBtn[reactKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
      }
    } catch (e) {}
    sendStatus('delivery', 'Delivery selected...');
    return { action: 'wait-navigation' };
  }

  async function handleClickAndCollect(config) {
    console.log(`${TAG} Handling click & collect page`);
    sendStatus('click-and-collect', 'Selecting C&C location...');

    // Wait for C&C page content to load
    try {
      await waitForAny([
        '[data-testid="postcode-input"]', 'input[name*="postcode" i]',
        'input[placeholder*="postcode" i]', '[class*="Selected location" i]'
      ], 6000);
    } catch (e) { /* continue anyway */ }

    const postcodeInput = document.querySelector('[data-testid="postcode-input"]')
      || document.querySelector('input[name*="postcode" i]')
      || document.querySelector('input[placeholder*="postcode" i]');
    if (postcodeInput) {
      // First C&C page — Very auto-fills the account postcode, just click Find Nearest
      console.log(`${TAG} C&C postcode already filled by Very: "${postcodeInput.value}"`);

      // Click find nearest
      const findBtn = Array.from(document.querySelectorAll('button')).find(
        b => /find nearest/i.test(b.textContent)
      );
      if (findBtn) {
        humanClick(findBtn);
        // Wait for location results to appear (scan, not blind wait)
        try {
          await waitForAny([
            'input[type="radio"]', '[class*="location" i] input', '[class*="store" i]'
          ], 6000);
          await randomDelay(200, 400); // tiny settle
        } catch (e) { /* continue anyway */ }
      }

      // Select first location (or by name)
      let locationRadios = document.querySelectorAll('input[name="location-selection"]');
      if (locationRadios.length === 0) locationRadios = document.querySelectorAll('input[type="radio"][name*="location" i]');
      if (locationRadios.length === 0) locationRadios = document.querySelectorAll('input[type="radio"][name*="store" i]');
      if (locationRadios.length === 0) {
        locationRadios = document.querySelectorAll('[class*="location" i] input[type="radio"], [class*="store" i] input[type="radio"], [data-testid*="location"] input[type="radio"]');
      }
      if (locationRadios.length > 0) {
        let targetRadio = locationRadios[0];
        if (config.ccStoreName) {
          for (const radio of locationRadios) {
            const parent = radio.closest('[class*="location" i], [class*="store" i], li, div') || radio.parentElement;
            if (parent && parent.textContent.toLowerCase().includes(config.ccStoreName.toLowerCase())) {
              targetRadio = radio;
              break;
            }
          }
        }
        if (!targetRadio.checked) {
          humanClick(targetRadio);
          await randomDelay(100, 200);
        }
        console.log(`${TAG} C&C location selected`);
      } else {
        console.log(`${TAG} No location radios found — assuming first is pre-selected`);
      }

      // Click continue on first page
      let continueBtn = Array.from(document.querySelectorAll('button')).find(
        b => /^continue$/i.test(b.textContent.trim())
      );
      if (!continueBtn) continueBtn = document.querySelector('button[type="submit"]');
      if (continueBtn) {
        humanClick(continueBtn);
        try { continueBtn.click(); } catch (e) {}
        console.log(`${TAG} Clicked C&C continue`);
      }

      // Wait for second C&C page — the page re-renders with "Selected method" and "Contact details"
      // We know we're on page 2 when "Selected method" appears (only on confirmation page)
      sendStatus('click-and-collect', 'Confirming C&C...');
      const ccStart = Date.now();
      while (Date.now() - ccStart < 10000) {
        if (detectPage() !== 'click-and-collect') {
          console.log(`${TAG} Already left C&C page — now on ${detectPage()}`);
          return { action: 'wait-navigation' };
        }
        // "Selected method" and "Change location" only appear on the confirmation page
        const isPage2 = document.body.textContent.includes('Selected method')
          || document.body.textContent.includes('Change location');
        if (isPage2) break;
        await new Promise(r => setTimeout(r, 300));
      }

      // Fall through to confirmation handler below
    }

    // Second C&C page — just click Continue
    sendStatus('click-and-collect', 'Confirming C&C details...');
    await randomDelay(150, 300);

    const confirmBtn = Array.from(document.querySelectorAll('button')).find(
      b => /^continue$/i.test(b.textContent.trim())
    );
    if (confirmBtn) {
      humanClick(confirmBtn);
      try { confirmBtn.click(); } catch (e) {}
      console.log(`${TAG} Clicked C&C confirmation continue`);
    } else {
      const fallback = await findButton({ textPatterns: ['continue'], fallbackText: 'continue' });
      if (fallback) {
        humanClick(fallback);
        try { fallback.click(); } catch (e) {}
      } else {
        throw new Error('C&C confirmation continue button not found');
      }
    }
    return { action: 'wait-navigation' };
  }

  async function handlePayment(config) {
    config = config || {};
    console.log(`${TAG} Handling payment page`);
    sendStatus('payment', 'Selecting payment...');

    // Wait for payment cards to load (radios take 1-2s to appear)
    try {
      await waitForAny([
        'input[type="radio"]', 'input[name*="payment" i]',
        '[data-testid*="stored-card"]'
      ], 8000);
      await randomDelay(100, 200); // tiny settle after cards appear
    } catch (e) { /* continue anyway */ }

    const paymentMethod = config.paymentMethod || 'card';

    if (paymentMethod === 'very-pay') {
      const radios = document.querySelectorAll('input[type="radio"]');
      for (const radio of radios) {
        const label = radio.closest('label, [class*="PaymentMethod"], [class*="payment"]') || radio.parentElement;
        if (label && /very pay|add to account|credit account|buy now pay later|bnpl/i.test(label.textContent)) {
          humanClick(radio);
          await randomDelay(150, 300);
          break;
        }
      }
    } else {
      // Card — first saved card is usually pre-selected
      const savedCard = document.querySelector('[data-testid="payment-methods-stored-card-1"] input, input#exisiting-card-0');
      if (savedCard && !savedCard.checked) {
        humanClick(savedCard);
        await randomDelay(100, 200);
      }
    }

    if (config.promoCode) {
      const promoInput = document.querySelector('[data-testid="promo-code-input"]');
      const promoBtn = document.querySelector('[data-testid="promo-code-button"]');
      if (promoInput && promoBtn) {
        await humanType(promoInput, config.promoCode);
        humanClick(promoBtn);
        await randomDelay(800, 1500);
      }
    }

    // Find Continue by text FIRST (the button has no useful data-testid)
    await randomDelay(80, 150);
    let continueBtn = Array.from(document.querySelectorAll('button')).find(
      b => /^continue$/i.test(b.textContent.trim())
    );
    if (!continueBtn) {
      // Broader search — any button/link containing "continue"
      continueBtn = Array.from(document.querySelectorAll('button, a')).find(
        b => /continue/i.test(b.textContent)
      );
    }
    if (!continueBtn) {
      continueBtn = await findButton({
        testIds: ['[data-testid="payment-total-action"]'],
        textPatterns: ['continue', 'add to account', 'pay now', 'proceed', 'place order'],
        fallbackText: 'continue|pay|place order'
      });
    }
    if (!continueBtn) throw new Error('Payment continue button not found');

    console.log(`${TAG} Payment continue btn found:`, continueBtn.tagName, continueBtn.className, continueBtn.textContent.trim().substring(0, 30));
    humanClick(continueBtn);
    await randomDelay(50, 100);
    // Native click fallback
    try { continueBtn.click(); } catch (e) {}
    await randomDelay(100, 200);
    // Focus + Enter fallback — most reliable for React buttons that ignore synthetic clicks
    try {
      continueBtn.focus();
      continueBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      continueBtn.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      continueBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } catch (e) {}
    // React internal handler fallback — trigger onClick from React's fiber props
    try {
      const reactKey = Object.keys(continueBtn).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
      if (reactKey && continueBtn[reactKey] && continueBtn[reactKey].onClick) {
        console.log(`${TAG} Triggering React onClick directly`);
        continueBtn[reactKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
      }
    } catch (e) {}
    sendStatus('payment', 'Payment selected...');
    return { action: 'wait-navigation' };
  }

  async function handleCCV(config) {
    console.log(`${TAG} Handling CCV page`);
    sendStatus('ccv', 'Entering security code...');

    // Wait for CCV content to load
    try {
      await waitForAny([
        '[data-testid*="security-code"]', '[data-testid*="cvv"]', '[data-testid*="ccv"]',
        'iframe[title*="card" i]', 'iframe[title*="security" i]'
      ], 8000);
    } catch (e) { /* continue anyway */ }

    // The CCV input is inside a CyberSource iframe
    // We need to find the iframe and type into it
    let ccvContainer = document.querySelector('[data-testid="security-code-input"]');
    if (!ccvContainer) {
      // Fallback: try other common selectors for the CCV/CVV area
      ccvContainer = document.querySelector('[data-testid*="security-code"], [data-testid*="cvv"], [data-testid*="ccv"]');
    }
    if (!ccvContainer) {
      // Fallback: look for label text near an iframe or input
      const labels = Array.from(document.querySelectorAll('label, span, div'));
      const cvvLabel = labels.find(l => /security code|cvv|ccv|card verification/i.test(l.textContent));
      if (cvvLabel) ccvContainer = cvvLabel.closest('div') || cvvLabel.parentElement;
    }
    if (!ccvContainer) {
      // Last resort: any iframe on the payment page (likely CyberSource)
      const iframe = document.querySelector('iframe[title*="card" i], iframe[title*="security" i], iframe[title*="cvv" i]');
      if (iframe) ccvContainer = iframe.parentElement;
    }
    if (!ccvContainer) throw new Error('CCV container not found');

    // Try to find the iframe
    const iframe = ccvContainer.querySelector('iframe');
    if (iframe) {
      // Focus the iframe container area and use keyboard to type
      // Cross-origin iframes can't be accessed directly, so we use
      // a click-then-type approach
      iframe.focus();
      await randomDelay(80, 150);

      // Click on the iframe to focus it
      humanClick(iframe);
      await randomDelay(100, 200);

      // Type the CCV using keyboard events on the document
      // The iframe should receive these if it has focus
      const ccv = config.ccv || config.cvv || '';
      for (const char of ccv) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        await randomDelay(50, 120);
      }
    } else {
      // No iframe — try direct input
      const ccvInput = ccvContainer.querySelector('input');
      if (ccvInput) {
        await humanType(ccvInput, config.ccv || config.cvv || '');
      }
    }

    await randomDelay(100, 200);

    // Confirm card is registered to address (Yes radio)
    let yesRadio = document.querySelector('[data-testid="card-address-yes"], input#account-address-yes');
    if (!yesRadio) {
      const labels = Array.from(document.querySelectorAll('label, [class*="radio"], [class*="Radio"]'));
      const yesLabel = labels.find(l => /\byes\b/i.test(l.textContent) && l.querySelector('input[type="radio"]'));
      if (yesLabel) yesRadio = yesLabel.querySelector('input[type="radio"]') || yesLabel;
    }
    if (yesRadio && !yesRadio.checked) {
      humanClick(yesRadio);
      await randomDelay(80, 150);
    }

    await randomDelay(100, 200);

    // Click Pay now
    const payBtn = await findButton({
      testIds: [
        '[data-testid="pay-now-button"]',
        '[data-testid*="pay-now"]',
        '[data-testid*="place-order"]',
        '[data-testid*="submit-payment"]'
      ],
      textPatterns: ['pay now', 'place order', 'complete purchase', 'submit payment', 'confirm payment'],
      fallbackText: 'pay|place order|complete'
    });
    if (!payBtn) throw new Error('Pay now button not found');

    // ── DRY RUN: stop before paying ──
    if (config.dryRun) {
      sendStatus('ccv', 'DRY RUN complete — payment NOT submitted');
      return { action: 'complete', orderRef: 'DRY-RUN', dryRun: true };
    }

    humanClick(payBtn);
    sendStatus('ccv', 'Payment submitted, waiting for confirmation...');

    // ── 3DS DETECTION: poll for 3DS challenge after pay click ──
    await randomDelay(800, 1200);

    const is3DS = () => {
      const url = window.location.href.toLowerCase();
      if (url.includes('3ds') || url.includes('threeds') || url.includes('/acs') || url.includes('secure/enrol')) return true;
      // Check for 3DS iframe providers
      const iframes = document.querySelectorAll('iframe');
      for (const f of iframes) {
        const src = (f.src || '').toLowerCase();
        if (src.includes('cardinal') || src.includes('arcot') || src.includes('3ds') || src.includes('acs') || src.includes('secure')) return true;
      }
      return false;
    };

    if (is3DS()) {
      sendStatus('3ds', 'Awaiting 3DS approval — complete in browser');
      // Poll until we leave the 3DS page (max 5 min)
      const threedsTimeout = 300000;
      const start = Date.now();
      while (Date.now() - start < threedsTimeout) {
        await new Promise(r => setTimeout(r, 2000));
        if (!is3DS()) break;
        // Also check if we've landed on confirmation
        if (window.location.href.includes('/checkout/confirmation')) break;
      }
      if (Date.now() - start >= threedsTimeout) {
        throw new Error('3DS approval timed out after 5 minutes');
      }
      sendStatus('3ds', '3DS approved, waiting for confirmation...');
    }

    return { action: 'wait-navigation' };
  }

  async function handleConfirmation() {
    console.log(`${TAG} Order confirmation page!`);

    await randomDelay(300, 600);

    // Scrape order reference
    const text = document.body.innerText || '';
    const patterns = [
      /Order reference number[:\s]*(\d+)/i,
      /Order reference[:\s]*(\d+)/i,
      /Order number[:\s]*(\d+)/i,
    ];

    let orderRef = null;
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) { orderRef = match[1]; break; }
    }

    // Fallback: long number
    if (!orderRef) {
      const nums = text.match(/\b\d{8,}\b/g);
      if (nums && nums.length === 1) orderRef = nums[0];
    }

    sendStatus('confirmation', `Order confirmed! Ref: ${orderRef || 'Unknown'}`);

    return {
      action: 'complete',
      orderRef: orderRef,
      url: window.location.href
    };
  }

  // ============================================================
  // COMMUNICATION WITH BACKGROUND / ELECTRON
  // ============================================================

  function sendStatus(step, message) {
    // Don't send if this tab's task has been cleared (ghost tab protection)
    if (!activeTask) {
      console.log(`${TAG} [GHOST] Suppressed status (no activeTask): [${step}] ${message}`);
      return;
    }
    console.log(`${TAG} [${step}] ${message}`);
    chrome.runtime.sendMessage({
      action: 'very-status',
      step,
      message,
      url: window.location.href,
      taskId: activeTask.taskId || null
    }).catch(() => {});
  }

  function sendResult(result) {
    chrome.runtime.sendMessage({
      action: 'very-result',
      ...result,
      taskId: activeTask?.taskId || null
    }).catch(() => {});
  }

  // ============================================================
  // MAIN AUTOMATION CONTROLLER
  // ============================================================

  let activeTask = null;
  let isRunning = false;
  let _pendingRerun = false; // set by SPA watcher if URL changes mid-run
  let _lastRunTime = 0; // debounce: prevent multiple runs within 2s

  async function runCheckout(config) {
    if (!config) {
      console.log(`${TAG} runCheckout called with null config — skipping`);
      return;
    }
    const now = Date.now();
    if (isRunning) {
      console.log(`${TAG} Already running — queuing re-run after current finishes`);
      _pendingRerun = true;
      return;
    }
    // Debounce: ignore truly duplicate triggers (within 300ms)
    if (now - _lastRunTime < 300) {
      console.log(`${TAG} Debounce — skipping (last run ${now - _lastRunTime}ms ago)`);
      return;
    }
    _lastRunTime = now;
    isRunning = true;
    _pendingRerun = false;
    activeTask = config;
    const startUrl = window.location.href; // track so we know if URL changed during handler

    console.log(`${TAG} Starting checkout automation | atcOnly=${config.atcOnly} | dryRun=${config.dryRun} | taskId=${config.taskId}`);

    try {
      let page = detectPage();
      console.log(`${TAG} Current page: ${page}`);

      // If page is "unknown", wait a moment — the URL may still be settling
      // (Stellar redirect can bounce through intermediate URLs)
      if (page === 'unknown') {
        await randomDelay(2000, 3000);
        page = detectPage();
        console.log(`${TAG} Re-detected page after settle: ${page}`);
        if (page === 'unknown') {
          // Still unknown — wait once more
          await randomDelay(2000, 3000);
          page = detectPage();
          console.log(`${TAG} Final page detection: ${page}`);
        }
      }

      // ── HOME PAGE REDIRECT: Very sometimes dumps you on home after login ──
      if (page === 'home') {
        console.log(`${TAG} On home page — redirecting to basket`);
        sendStatus('home', 'Redirecting to basket...');
        window.location.href = 'https://www.very.co.uk/basket';
        isRunning = false;
        return; // page reload will re-trigger via auto-start
      }

      let result;

      switch (page) {
        case 'login':
          result = await handleLogin(config);
          // login succeeded — SPA watcher will pick up next page
          break;
        case 'basket':
          result = await handleBasket(config);
          break;
        case 'delivery':
          result = await handleDelivery(config);
          break;
        case 'click-and-collect':
          result = await handleClickAndCollect(config);
          break;
        case 'payment':
          result = await handlePayment(config);
          break;
        case 'ccv':
          result = await handleCCV(config);
          break;
        case 'confirmation':
          result = await handleConfirmation();
          break;
        default:
          // Check if it's a technical error / splash page → auto-refresh
          if (isTechnicalErrorPage()) {
            console.log(`${TAG} Technical error page detected, refreshing...`);
            sendStatus('error', 'Technical error page, refreshing...');
            await randomDelay(2000, 4000);
            window.location.reload();
            result = { action: 'wait-reload' };
          } else {
            sendStatus('unknown', `Unknown page: ${window.location.href}`);
            // Wait a bit and try once more (page might still be loading)
            await randomDelay(3000, 5000);
            if (isTechnicalErrorPage()) {
              console.log(`${TAG} Technical error page detected (delayed), refreshing...`);
              sendStatus('error', 'Technical error page, refreshing...');
              await randomDelay(1000, 2000);
              window.location.reload();
              result = { action: 'wait-reload' };
            } else {
              result = { action: 'unknown' };
            }
          }
      }

      if (result.action === 'complete') {
        sendResult({ success: true, orderRef: result.orderRef, dryRun: result.dryRun || false });
        activeTask = null; // Task done — prevent this tab from ghosting on future tasks
        console.log(`${TAG} Task complete, activeTask cleared`);
      } else if (result.action === 'error') {
        sendResult({ success: false, error: result.error });
        activeTask = null; // Task failed — same cleanup
        console.log(`${TAG} Task errored, activeTask cleared`);
      }
      // 'wait-navigation' and 'wait-reload' — the SPA watcher will pick up the next page

    } catch (err) {
      console.error(`${TAG} Checkout error:`, err);

      // If the error was "element not found" and we're on a technical error page, refresh instead of failing
      if (isTechnicalErrorPage()) {
        console.log(`${TAG} Error on technical error page — refreshing instead of failing`);
        sendStatus('error', 'Technical error page, refreshing...');
        await randomDelay(2000, 4000);
        window.location.reload();
        // Don't send failure result — the reload will retry
      } else if (window.location.href !== startUrl && _pendingRerun) {
        // URL changed during handler — error is likely stale (element from OLD page).
        // Don't send failure — the re-run in finally will handle the new page.
        console.log(`${TAG} Error but URL changed (${startUrl} → ${window.location.href}) — not failing, will re-run`);
      } else {
        sendStatus('error', err.message);
        sendResult({ success: false, error: err.message });
        activeTask = null; // Task crashed — prevent ghost tab
        console.log(`${TAG} Task crashed, activeTask cleared`);
      }
    } finally {
      isRunning = false;

      // If the URL changed while we were running (e.g. basket → login redirect),
      // re-run on the new page so we don't get stuck.
      // Use config (param) as fallback in case activeTask was cleared by error handler
      if (_pendingRerun) {
        _pendingRerun = false;
        const rerunConfig = activeTask || config;
        if (rerunConfig) {
          console.log(`${TAG} URL changed during run — re-running on: ${window.location.href}`);
          activeTask = rerunConfig; // restore if it was cleared
          setTimeout(() => runCheckout(rerunConfig), 500);
        }
      }
    }
  }

  // ============================================================
  // SPA NAVIGATION WATCHER
  // ============================================================

  let lastUrl = window.location.href;

  const origPushState = history.pushState.bind(history);
  const origReplaceState = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPushState(...args);
    onUrlChange();
  };
  history.replaceState = function (...args) {
    origReplaceState(...args);
    onUrlChange();
  };
  window.addEventListener('popstate', onUrlChange);

  // Polling fallback for URL changes
  setInterval(() => {
    if (window.location.href !== lastUrl) onUrlChange();
  }, 500);

  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;
    console.log(`${TAG} Navigation detected: ${newUrl}`);

    // If we have an active task, continue automation on the new page
    if (activeTask) {
      setTimeout(() => {
        // Re-check: if task completed/stopped while we waited, don't re-run
        if (activeTask) runCheckout(activeTask);
      }, 500);
    }
  }

  // ============================================================
  // MESSAGE LISTENER (from background script / Electron)
  // ============================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log(`${TAG} Message received:`, request);

    if (request.action === 'very-ping') {
      sendResponse({ status: 'ok', page: detectPage(), url: window.location.href });
      return true;
    }

    if (request.action === 'very-start') {
      // Start checkout automation with provided config
      _lastRunTime = 0; // reset debounce so new task isn't blocked
      _earlyReloadFired = false; // reset early reload flag
      runCheckout(request.config);
      sendResponse({ started: true });
      return true;
    }

    if (request.action === 'very-stop') {
      activeTask = null;
      isRunning = false;
      sendResponse({ stopped: true });
      return true;
    }

    return true;
  });

  // ============================================================
  // EARLY SESSION-EXPIRED WATCHER
  // If we land on the login page and "session expired" is already
  // visible, refresh immediately BEFORE the automation tries to
  // fill credentials. After reload, the page is clean and login
  // works first time.
  // ============================================================

  function earlySessionCheck() {
    if (detectPage() !== 'login') return;

    // Give the page a moment to render error banners
    setTimeout(() => {
      // Don't reload if automation is already running — handleLogin handles errors itself
      if (isRunning || activeTask) {
        console.log(`${TAG} [EARLY] Skipping — automation already running`);
        return;
      }
      const error = checkLoginErrors();
      if (error === 'expired') {
        console.log(`${TAG} [EARLY] Session expired detected on page load — refreshing`);
        _earlyReloadFired = true;
        sendStatus('login', 'Session expired on load — refreshing...');
        // Short delay so the status message gets sent before reload
        setTimeout(() => window.location.reload(), 500);
      } else if (error === 'rate-limit') {
        console.log(`${TAG} [EARLY] Rate limit detected on page load — waiting then refreshing`);
        _earlyReloadFired = true;
        sendStatus('login', 'Rate limited — waiting 5s then refreshing...');
        setTimeout(() => window.location.reload(), 5000);
      }
    }, 1500);
  }

  // Run the early check now
  earlySessionCheck();

  // ============================================================
  // AUTO-START: If loaded with an active task in storage
  // ============================================================

  chrome.storage.local.get('veryActiveTask', (result) => {
    if (result.veryActiveTask) {
      // Don't auto-start if a task is already running (e.g. very-start message arrived first)
      if (activeTask || isRunning) {
        console.log(`${TAG} Found active task in storage but already running — skipping auto-start`);
        return;
      }
      console.log(`${TAG} Found active task in storage, auto-starting in 2s...`);
      setTimeout(() => {
        // Re-check before actually starting (very-start may have arrived during the 2s wait)
        if (activeTask || isRunning) {
          console.log(`${TAG} Auto-start cancelled — task already running`);
          return;
        }
        runCheckout(result.veryActiveTask);
      }, 2000);
    }
  });

})();
