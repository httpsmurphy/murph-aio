/**
 * Very Order Tracker — Content script for very.co.uk
 * Scrapes basket items on checkout pages and sends order data
 * to a Discord webhook when an order is confirmed.
 *
 * SPA-aware: watches for client-side navigation so it catches
 * payment → confirmation transitions without a full page reload.
 *
 * Shows an on-page overlay on very.co.uk if no Discord username
 * is saved, so users MUST enter it before anything else.
 *
 * Sends one webhook per item on order confirmation.
 *
 * SAFETY: Every order is saved to chrome.storage.local BEFORE
 * the webhook is attempted. Even if the webhook fails, the order
 * is logged locally and can be recovered.
 */

(function () {
  'use strict';

  // Persistent deduplication: stored in chrome.storage.local so it survives
  // extension reloads and page refreshes.
  let processedOrderRefs = new Set();
  let lastKnownUrl = window.location.href;
  let pollIntervalId = null;

  // Load previously processed order refs from storage on startup
  let _refsLoaded = false;
  const _refsReady = new Promise((resolve) => {
    chrome.storage.local.get('veryProcessedRefs', (result) => {
      if (result.veryProcessedRefs && Array.isArray(result.veryProcessedRefs)) {
        processedOrderRefs = new Set(result.veryProcessedRefs);
      }
      _refsLoaded = true;
      resolve();
    });
  });

  function saveProcessedRefs() {
    // Keep last 200 refs to avoid unbounded growth
    const refs = [...processedOrderRefs].slice(-200);
    chrome.storage.local.set({ veryProcessedRefs: refs });
  }

  // ========================= DISCORD USERNAME OVERLAY =========================

  async function ensureDiscordUsername() {
    try {
      const { discordUsername } = await chrome.storage.local.get('discordUsername');
      if (discordUsername) return discordUsername;
    } catch (e) {
      console.error('[Very Tracker] Storage read failed:', e);
    }

    // No username — inject an overlay onto the page with a 5-minute timeout
    return new Promise((resolve) => {
      let resolved = false;

      const overlay = document.createElement('div');
      overlay.id = 'aco-discord-overlay';
      overlay.innerHTML = `
        <div style="
          position:fixed; inset:0; z-index:2147483647;
          background:rgba(0,0,0,0.75);
          display:flex; align-items:center; justify-content:center;
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
        ">
          <div style="
            background:#1a1a1a;
            border:1px solid #333;
            border-radius:12px; padding:32px; width:380px; max-width:90vw;
            box-shadow:0 20px 50px rgba(0,0,0,0.6);
            display:flex; flex-direction:column; align-items:center; gap:14px;
          ">
            <p style="color:#fff; font-size:15px; text-align:center; margin:0;">
              Enter your Discord username to continue
            </p>
            <div style="display:flex; gap:8px; width:100%;">
              <input
                type="text"
                id="aco-discord-input"
                placeholder="Discord username"
                style="
                  flex:1; height:42px; padding:0 14px;
                  background:#111; color:#fff; font-size:14px;
                  border-radius:8px; border:1px solid #444;
                  outline:none; font-family:inherit;
                "
              />
              <button
                id="aco-discord-submit"
                style="
                  height:42px; padding:0 20px; border-radius:8px;
                  background:#333; color:#fff; font-size:14px; font-weight:600;
                  border:1px solid #555; cursor:pointer; font-family:inherit;
                  transition:background 0.2s;
                "
                onmouseover="this.style.background='#444'"
                onmouseout="this.style.background='#333'"
              >Submit</button>
            </div>
            <p id="aco-discord-error" style="color:#f87171; font-size:12px; min-height:16px; margin:0;"></p>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const input = document.getElementById('aco-discord-input');
      const btn = document.getElementById('aco-discord-submit');
      const err = document.getElementById('aco-discord-error');

      setTimeout(() => input.focus(), 100);

      async function submit() {
        if (resolved) return;
        const name = input.value.trim();
        if (!name) {
          err.textContent = 'Please enter your Discord username';
          return;
        }
        err.textContent = '';
        resolved = true;
        await chrome.storage.local.set({ discordUsername: name });

        overlay.style.transition = 'opacity 0.3s';
        overlay.style.opacity = '0';
        setTimeout(() => {
          overlay.remove();
          resolve(name);
        }, 300);
      }

      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });

      // Safety timeout: resolve with 'Unknown' after 5 minutes so we don't hang forever
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.warn('[Very Tracker] Username overlay timed out — using "Unknown"');
          overlay.remove();
          resolve('Unknown');
        }
      }, 5 * 60 * 1000);
    });
  }

  // ========================= ITEM SCRAPING =========================

  /**
   * Scrape items using Very's actual DOM structure.
   * Tries multiple strategies matching basket, delivery, and payment pages.
   * Always returns an array of { name, quantity, price }.
   */
  function scrapeItems() {
    const url = window.location.href;
    let items = [];

    // --- Strategy 1: Basket page (/basket) ---
    // Container: [class*="LineItemContainer-sc-na28s8"]
    // Name:      h3[class*="ItemDescription"]
    // Qty:       <select> value
    // Price:     [class*="NowPrice-sc"]
    if (url.includes('/basket')) {
      const containers = document.querySelectorAll('[class*="LineItemContainer-sc-na28s8"]');
      containers.forEach((container) => {
        const nameEl = container.querySelector('h3[class*="ItemDescription"], h3');
        const selectEl = container.querySelector('select');
        const nowPriceEl = container.querySelector('[class*="NowPrice-sc"]');

        const name = nameEl?.textContent?.trim() || '';
        let qty = 1;
        if (selectEl) {
          const parsed = parseInt(selectEl.value, 10);
          if (!isNaN(parsed)) qty = parsed;
        }
        // NowPrice might contain "£29.99£23.99" — take the last £ value
        let price = '?';
        if (nowPriceEl) {
          const matches = nowPriceEl.textContent.match(/£[\d,.]+/g);
          if (matches) price = matches[matches.length - 1];
        }

        if (name) items.push({ name, quantity: qty, price });
      });
    }

    // --- Strategy 2: Delivery page (/checkout/delivery) ---
    // Container: [class*="LineItemContainer-sc-3adkr2"] or [class*="MainItemInfoBox"]
    // Name:      [class*="InfoContainer"] h3
    // Qty:       [class*="Quantity-sc-mhouck"] → "Quantity: X"
    // Price:     Screen reader span "Current price: £X" or last price <p>
    if (url.includes('/checkout/delivery')) {
      const containers = document.querySelectorAll('[class*="LineItemContainer-sc-3adkr2"]');
      containers.forEach((container) => {
        const nameEl = container.querySelector('[class*="InfoContainer"] h3, h3');
        const qtyEl = container.querySelector('[class*="Quantity-sc"]');
        const srSpans = container.querySelectorAll('[class*="ScreenReaderOnly"]');

        const name = nameEl?.textContent?.trim() || '';
        let qty = 1;
        if (qtyEl) {
          const match = qtyEl.textContent.match(/\d+/);
          if (match) qty = parseInt(match[0], 10);
        }
        let price = '?';
        // Prefer screen reader "Current price: £XX.XX"
        srSpans.forEach((span) => {
          const match = span.textContent.match(/Current price:\s*(£[\d,.]+)/i);
          if (match) price = match[1];
        });
        // Fallback: last visible price element
        if (price === '?') {
          const priceEls = container.querySelectorAll('[class*="Price-sc"]');
          priceEls.forEach((p) => {
            const m = p.textContent.match(/£[\d,.]+/);
            if (m) price = m[0];
          });
        }

        if (name) items.push({ name, quantity: qty, price });
      });
    }

    // --- Strategy 3: Payment page (/checkout/payment) ---
    // Container: [class*="ItemContainer-sc-3ig894"]
    // Name:      [class*="TitleContainer"] h3
    // Qty:       [class*="Quantity"] → "Quantity: X"
    // Price:     Screen reader "Current price: £X" or last £ value
    if (url.includes('/checkout/payment')) {
      const containers = document.querySelectorAll('[class*="ItemContainer-sc-3ig894"]');
      containers.forEach((container) => {
        const nameEl = container.querySelector('[class*="TitleContainer"] h3, h3');
        const qtyEl = container.querySelector('[class*="Quantity"]');
        const srSpans = container.querySelectorAll('[class*="ScreenReaderOnly"]');

        const name = nameEl?.textContent?.trim() || '';
        let qty = 1;
        if (qtyEl) {
          const match = qtyEl.textContent.match(/\d+/);
          if (match) qty = parseInt(match[0], 10);
        }
        let price = '?';
        srSpans.forEach((span) => {
          const match = span.textContent.match(/Current price:\s*(£[\d,.]+)/i);
          if (match) price = match[1];
        });
        if (price === '?') {
          const allPrices = container.textContent.match(/£[\d,.]+/g);
          if (allPrices) price = allPrices[allPrices.length - 1];
        }

        if (name) items.push({ name, quantity: qty, price });
      });
    }

    // --- Fallback: generic text-based scraping ---
    if (items.length === 0) {
      items = scrapeItemsGeneric();
    }

    return items;
  }

  function scrapeItemsGeneric() {
    const items = [];
    const body = document.body.innerText;

    // Look for "Item X of Y" blocks (delivery page)
    const itemBlocks = body.split(/Item \d+ of \d+/);
    if (itemBlocks.length > 1) {
      for (let i = 1; i < itemBlocks.length; i++) {
        const block = itemBlocks[i].trim();
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        const name = lines[0] || 'Unknown item';
        let qty = 1;
        const qtyLine = lines.find((l) => /Quantity/i.test(l));
        if (qtyLine) {
          const match = qtyLine.match(/\d+/);
          if (match) qty = parseInt(match[0], 10);
        }
        let price = '?';
        for (const line of lines) {
          const match = line.match(/£[\d,.]+/);
          if (match) price = match[0];
        }
        items.push({ name, quantity: qty, price });
      }
    }

    // Fallback: look for "Quantity: X" near product names
    if (items.length === 0) {
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        if (/^Quantity/i.test(lines[i]) && i > 0) {
          const name = lines[i - 1] || 'Unknown';
          const qtyMatch = lines[i].match(/\d+/);
          const qty = qtyMatch ? parseInt(qtyMatch[0], 10) : 1;
          let price = '?';
          for (let j = i; j < Math.min(i + 5, lines.length); j++) {
            const m = lines[j].match(/£[\d,.]+/);
            if (m) { price = m[0]; break; }
          }
          items.push({ name, quantity: qty, price });
        }
      }
    }

    return items;
  }

  /**
   * Scrape delivery mode and shipping fee from delivery/payment pages.
   * Returns { mode: 'delivery'|'collection', deliveryFee: '£3.99'|'FREE' }
   */
  function scrapeDeliveryInfo() {
    const info = { mode: 'delivery', deliveryFee: '?' };
    const bodyText = document.body.innerText;

    // Check for Click & Collect being selected
    // On delivery page: a selected radio/option for Click & Collect
    const collectEl = document.querySelector('[class*="ClickCollect"] input:checked, [class*="click-collect"] input:checked');
    if (collectEl) {
      info.mode = 'collection';
    }
    // Also check by text — if "Click & Collect" appears near a selected state or store name
    const allEls = document.querySelectorAll('[class*="collect"], [class*="Collect"]');
    for (const el of allEls) {
      // If there's a store name shown, they've selected click & collect
      if (el.textContent.includes('Collect from') || el.textContent.includes('Collection point')) {
        info.mode = 'collection';
        break;
      }
    }

    // Scrape delivery fee from order summary
    const summaryEls = document.querySelectorAll('p, span, h1, div');
    for (let i = 0; i < summaryEls.length; i++) {
      const txt = summaryEls[i].textContent.trim();
      if (txt === 'Delivery') {
        // Next sibling or next element should have the fee
        const next = summaryEls[i].nextElementSibling || summaryEls[i + 1];
        if (next) {
          const feeText = next.textContent.trim();
          if (/£[\d,.]+/.test(feeText)) {
            info.deliveryFee = feeText.match(/£[\d,.]+/)[0];
          } else if (/free/i.test(feeText)) {
            info.deliveryFee = 'FREE';
          }
        }
      }
    }

    // If delivery fee is FREE or £0.00, could be collection
    if (info.deliveryFee === 'FREE' || info.deliveryFee === '£0.00') {
      // Check if body text mentions click & collect
      if (/click\s*&?\s*collect/i.test(bodyText)) {
        info.mode = 'collection';
      }
    }

    return info;
  }

  /**
   * Scrape delivery recipient info from Very's checkout pages.
   * Very's delivery page layout (observed):
   *   Left column:  "Home address" heading → address lines (e.g. "6 RISDENS HARLOW\nESSEX\nCM18 7NH")
   *                 + "Change address" link
   *   Right column: "Information required for this delivery"
   *                 → Mobile input, Other number input, Email input
   *
   * Returns { name, email, address, phone } — any may be null.
   * Email + address are the strongest identity signals on Very.
   */
  function scrapeDeliveryRecipient() {
    const result = { name: null, email: null, address: null, phone: null };

    // ===== STRATEGY 1: "Home address" text block =====
    // Very shows a heading "Home address" with address lines below it.
    // No recipient name is displayed on the delivery page — just the address.
    const allEls = document.querySelectorAll('h1, h2, h3, h4, h5, strong, b, p, span, div');
    for (let i = 0; i < allEls.length; i++) {
      const txt = allEls[i].textContent.trim();
      if (/^Home address$/i.test(txt) || /^Delivery address$/i.test(txt) || /^Delivering to$/i.test(txt)) {
        // Grab the parent container's full text — address lines follow the heading
        const parent = allEls[i].parentElement;
        if (parent) {
          const parentText = parent.innerText || parent.textContent || '';
          const lines = parentText.split('\n').map(l => l.trim()).filter(Boolean);

          // Skip the heading line itself, collect address lines
          const addrLines = [];
          let pastHeading = false;
          for (const line of lines) {
            if (!pastHeading) {
              if (/home address|delivery address|delivering to/i.test(line)) {
                pastHeading = true;
              }
              continue;
            }
            // Stop at "Change address" or similar links
            if (/change address|edit address/i.test(line)) break;
            addrLines.push(line);
          }

          if (addrLines.length > 0) {
            // Check if first line looks like a name (contains letters, no digits at start, has a space)
            const firstLine = addrLines[0];
            if (
              firstLine.length >= 4 &&
              firstLine.includes(' ') &&
              /^[A-Za-z]/.test(firstLine) &&
              !/^[A-Z]{1,2}\d/.test(firstLine) && // not a postcode
              !/^\d/.test(firstLine) // not a house number
            ) {
              result.name = firstLine;
              result.address = addrLines.slice(1).join(', ').substring(0, 200);
            } else {
              result.address = addrLines.join(', ').substring(0, 200);
            }
          }
        }
        break;
      }
    }

    // ===== STRATEGY 2: Email from form input =====
    // Very shows an email input on the delivery page — great for identity matching.
    const emailInput = document.querySelector(
      'input[type="email"], input[name*="email"], input[id*="email"], ' +
      'input[autocomplete="email"], input[placeholder*="email" i]'
    );
    if (emailInput && emailInput.value && emailInput.value.includes('@')) {
      result.email = emailInput.value.trim();
    }

    // ===== STRATEGY 3: Phone number from form input =====
    const phoneInput = document.querySelector(
      'input[type="tel"], input[name*="mobile"], input[name*="phone"], ' +
      'input[id*="mobile"], input[id*="phone"], input[autocomplete="tel"]'
    );
    if (phoneInput && phoneInput.value) {
      result.phone = phoneInput.value.trim();
    }

    // ===== STRATEGY 4: Name from form inputs (if visible) =====
    if (!result.name) {
      const firstNameInput = document.querySelector(
        'input[name*="firstName"], input[name*="first_name"], input[name*="firstname"], ' +
        'input[autocomplete="given-name"], input[id*="firstName"], input[id*="first-name"]'
      );
      const lastNameInput = document.querySelector(
        'input[name*="lastName"], input[name*="last_name"], input[name*="lastname"], ' +
        'input[autocomplete="family-name"], input[id*="lastName"], input[id*="last-name"]'
      );
      if (firstNameInput?.value && lastNameInput?.value) {
        result.name = `${firstNameInput.value.trim()} ${lastNameInput.value.trim()}`;
      }
    }

    // ===== STRATEGY 5: Confirmation page — look for "Delivering to" or address summary =====
    if (window.location.href.includes('/checkout/confirmation')) {
      const bodyText = document.body.innerText;

      // Try to find a name near delivery-related headings
      if (!result.name) {
        const deliverMatch = bodyText.match(
          /Deliver(?:ing)?\s+to[:\s]*\n\s*(.+)/i
        );
        if (deliverMatch) {
          const line = deliverMatch[1].trim();
          if (line.length >= 3 && line.length <= 60 && !line.includes('£') && /^[A-Za-z]/.test(line)) {
            result.name = line;
          }
        }
      }

      // Try to find address on confirmation page if not already found
      if (!result.address) {
        // UK postcode pattern as anchor
        const postcodeMatch = bodyText.match(
          /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i
        );
        if (postcodeMatch) {
          // Find the postcode in context — grab the few lines before it
          const pcIdx = bodyText.indexOf(postcodeMatch[0]);
          if (pcIdx > 0) {
            const before = bodyText.substring(Math.max(0, pcIdx - 200), pcIdx + postcodeMatch[0].length);
            const lines = before.split('\n').map(l => l.trim()).filter(Boolean);
            // Take last 3-4 lines ending at the postcode
            const addrLines = lines.slice(-4);
            result.address = addrLines.join(', ').substring(0, 200);
          }
        }
      }
    }

    // ===== STRATEGY 6: Fallback — extract email from page text =====
    if (!result.email) {
      const bodyText = document.body.innerText;
      const emailMatch = bodyText.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch) {
        result.email = emailMatch[0];
      }
    }

    return result;
  }

  function scrapeOrderReference() {
    const text = document.body.innerText;

    // Try multiple patterns in case Very changes their wording
    const patterns = [
      /Order reference number[:\s]*(\d+)/i,
      /Order reference[:\s]*(\d+)/i,
      /Order number[:\s]*(\d+)/i,
      /Order ID[:\s]*(\d+)/i,
      /Reference[:\s]*#?(\d{6,})/i, // at least 6 digits to avoid false matches
      /Confirmation[:\s]*#?(\d{6,})/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1];
    }

    // Last resort: look for a long number on the confirmation page
    // (Very order refs are typically 8+ digits)
    const longNumbers = text.match(/\b\d{8,}\b/g);
    if (longNumbers && longNumbers.length === 1) {
      return longNumbers[0]; // only use if there's exactly one to avoid false positives
    }

    return null;
  }

  // ========================= MAIN PAGE CHECK =========================

  // Track which basket URLs we've already scraped this session (URL-based, in-memory is fine)
  const scrapedBasketUrls = new Set();

  async function checkPage() {
    const url = window.location.href;

    // --- Scrape basket items on basket / checkout pages ---
    // Always overwrite with latest so we capture the final state
    if (
      url.includes('very.co.uk/basket') ||
      url.includes('very.co.uk/checkout/delivery') ||
      url.includes('very.co.uk/checkout/payment')
    ) {
      if (!scrapedBasketUrls.has(url)) {
        scrapedBasketUrls.add(url);
        await new Promise((r) => setTimeout(r, 2000));

        const items = scrapeItems();
        const deliveryInfo = scrapeDeliveryInfo();
        const recipient = scrapeDeliveryRecipient();

        if (items.length > 0) {
          const storageData = {
            veryBasketItems: items,
            veryDeliveryInfo: deliveryInfo,
          };
          // Store recipient if found (may not be available on basket page)
          if (recipient.name || recipient.address) {
            storageData.veryRecipient = recipient;
          }
          await chrome.storage.local.set(storageData);
          console.log('[Very Tracker] Stored basket items:', items, 'Delivery:', deliveryInfo, 'Recipient:', recipient);
        }
      }
    }

    // --- Detect order confirmation page ---
    if (url.includes('very.co.uk/checkout/confirmation')) {
      await new Promise((r) => setTimeout(r, 2000));

      const orderRef = scrapeOrderReference();

      // Persistent dedup: check if we've already processed this order ref
      if (orderRef && processedOrderRefs.has(orderRef)) {
        console.log('[Very Tracker] Order', orderRef, 'already processed — skipping.');
        return;
      }

      const { veryBasketItems, veryDeliveryInfo, veryRecipient } = await chrome.storage.local.get([
        'veryBasketItems',
        'veryDeliveryInfo',
        'veryRecipient',
      ]);

      // Also try to scrape recipient directly from the confirmation page
      const confirmRecipient = scrapeDeliveryRecipient();
      // Merge: prefer stored data from delivery page (more fields), confirmation page as fallback
      const finalRecipient = {
        name: (veryRecipient && veryRecipient.name) || confirmRecipient.name || null,
        email: (veryRecipient && veryRecipient.email) || confirmRecipient.email || null,
        address: (veryRecipient && veryRecipient.address) || confirmRecipient.address || null,
        phone: (veryRecipient && veryRecipient.phone) || confirmRecipient.phone || null,
      };

      // Ensure we have a Discord username (will show overlay if not)
      const discordUsername = await ensureDiscordUsername();

      const orderData = {
        username: discordUsername || 'Unknown',
        orderRef: orderRef || 'UNKNOWN-' + Date.now(),
        items: veryBasketItems || [],
        deliveryInfo: veryDeliveryInfo || { mode: 'delivery', deliveryFee: '?' },
        recipient: finalRecipient,
        timestamp: new Date().toISOString(),
        url: url,
      };

      // ========= FAILSAFE: Save order locally FIRST =========
      // This ensures the order is NEVER lost, even if the webhook fails.
      // Saved with status 'pending' → updated to 'sent' or 'failed' after webhook.
      try {
        const { veryOrderLog = [] } = await chrome.storage.local.get('veryOrderLog');
        veryOrderLog.push({
          ...orderData,
          webhookStatus: 'pending',
          savedAt: new Date().toISOString(),
        });
        // Keep last 500 orders
        if (veryOrderLog.length > 500) veryOrderLog.splice(0, veryOrderLog.length - 500);
        await chrome.storage.local.set({ veryOrderLog });
        console.log('[Very Tracker] Order saved to local log:', orderData.orderRef);
      } catch (e) {
        console.error('[Very Tracker] Failed to save local order log:', e);
      }

      // Mark as processed (persistent across reloads)
      if (orderRef) {
        processedOrderRefs.add(orderRef);
        saveProcessedRefs();
      }

      // Warn if order ref wasn't found but still proceed
      if (!orderRef) {
        console.warn('[Very Tracker] Could not find order reference — sending with fallback ID.');
      }

      // Warn if no items were captured
      if (!veryBasketItems || veryBasketItems.length === 0) {
        console.warn('[Very Tracker] No basket items captured — webhook will note this.');
      }

      // ========= Send to background script for webhook delivery =========
      try {
        chrome.runtime.sendMessage(
          { type: 'veryOrderComplete', data: orderData },
          (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Very Tracker] Message send error:', chrome.runtime.lastError.message);
              updateOrderLogStatus(orderData.orderRef, 'failed', chrome.runtime.lastError.message);
              return;
            }
            if (response && response.success) {
              console.log('[Very Tracker] Order sent to webhook successfully.');
              updateOrderLogStatus(orderData.orderRef, 'sent');
              // Only clear basket AFTER successful webhook
              chrome.storage.local.remove(['veryBasketItems', 'veryDeliveryInfo', 'veryRecipient']);
            } else {
              console.error('[Very Tracker] Webhook failed:', response);
              updateOrderLogStatus(orderData.orderRef, 'failed', JSON.stringify(response));
            }
          }
        );
      } catch (e) {
        console.error('[Very Tracker] Failed to send message to background:', e);
        updateOrderLogStatus(orderData.orderRef, 'failed', e.message);
      }
    }
  }

  /**
   * Update the webhook status in the local order log.
   */
  async function updateOrderLogStatus(orderRef, status, error) {
    try {
      const { veryOrderLog = [] } = await chrome.storage.local.get('veryOrderLog');
      const entry = veryOrderLog.find((o) => o.orderRef === orderRef && o.webhookStatus === 'pending');
      if (entry) {
        entry.webhookStatus = status;
        if (error) entry.webhookError = error;
        entry.updatedAt = new Date().toISOString();
        await chrome.storage.local.set({ veryOrderLog });
      }
    } catch (e) {
      console.error('[Very Tracker] Failed to update order log status:', e);
    }
  }

  // ========================= SPA NAVIGATION DETECTION =========================

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

  function onPopState() { onUrlChange(); }
  window.addEventListener('popstate', onPopState);

  // Polling fallback — track the interval so we can clean up
  pollIntervalId = setInterval(() => {
    if (window.location.href !== lastKnownUrl) {
      onUrlChange();
    }
  }, 1000);

  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl === lastKnownUrl) return;
    lastKnownUrl = newUrl;
    console.log('[Very Tracker] URL changed:', newUrl);
    setTimeout(() => checkPage(), 500);
  }

  // Clean up on content script unload (tab close, extension disable, navigation away)
  window.addEventListener('beforeunload', () => {
    if (pollIntervalId) clearInterval(pollIntervalId);
    window.removeEventListener('popstate', onPopState);
  });

  // ========================= INITIAL RUN =========================

  async function init() {
    await _refsReady; // Ensure processed refs are loaded before checking pages
    await ensureDiscordUsername();
    checkPage();
  }

  init();
})();
