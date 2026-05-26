/**
 * Wrapped so `chrome.scripting.executeScript`/reload can reinject files without top-level `const` re-declaration crashes.
 */
(function initXdmAdapter() {
  if (window.__XDM_ADAPTER_INITIALIZED__) return;
  window.__XDM_ADAPTER_INITIALIZED__ = true;

  window.XDM = window.XDM || {};

  /**
   * @returns {Promise<{ result: 'deleted' | 'skipped' | 'none'; detail?: string }>}
   */
  async function deleteOneSentMessage() {
    return deleteOutgoingDmViaUi();
  }

  window.XDM.adapter = {
    deleteOneSentMessage,
  };

  async function sleep(ms) {
    return window.XDM.viewport.sleep(ms);
  }

  /** @returns {Element[]} */
  function querySelDeep(sel) {
    if (typeof window.XDM.deepQueryAll === 'function') return window.XDM.deepQueryAll(sel);
    return [...document.querySelectorAll(sel)];
  }

  function getConversationRootForLayout() {
    return (
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('[data-testid="DmActivityViewport"]') ||
      document.querySelector('main') ||
      document.body
    );
  }

  /** Outermost row when wildcard matches ancestors + descendants */
  function filterOutermostRowCandidates(elements) {
    return elements.filter((el) => !elements.some((o) => o !== el && o.contains(el)));
  }

  function collectClassicMessageRoots() {
    const set = new Set();
    const sels = ['[data-testid="messageEntry"]', '[data-testid="DMCompositeMessage"]'];
    for (const s of sels) querySelDeep(s).forEach((n) => set.add(n));
    return [...set];
  }

  const TID_EXCLUDE =
    /composer|Composer|Placeholder|Gif|Search|Sticker|Typing|Toolbar|Reaction|Quoted|Follow|timeline|conversationList|participant|Header|Create|NewChat|EmptyState|close|Close|settings|Settings|Attachment|emoji|Emoji|Picker|pinned|Banner|Promo|Upsell|premium|Premium|SideBar|sidebar|DmInbox|InboxSidebar/i;

  const TID_INCLUDE =
    /essage|ubble|onversation|Dm.*ssage|chat.*ssage|Outgoing|Sent|UserMessage|recipient|messageRow|bubbleRow|message_bubble|^msg/i;

  function tidOf(el) {
    return el.getAttribute('data-testid') || '';
  }

  function collectWildcardMessageRoots() {
    const rows = [];
    for (const el of querySelDeep('[data-testid]')) {
      const t = tidOf(el);
      if (t.length < 3) continue;
      if (TID_EXCLUDE.test(t)) continue;
      if (!TID_INCLUDE.test(t)) continue;
      rows.push(el);
    }
    return [...new Set(rows)];
  }

  function logTestIdHintsWhenEmpty() {
    const interesting = new Set();
    for (const el of querySelDeep('[data-testid]')) {
      const t = tidOf(el);
      if (t.length > 120) continue;
      if (/\b(dm|chat|message|conversation|bubble)\b/i.test(t)) interesting.add(t);
    }
    const list = [...interesting].sort().slice(0, 60);
    if (list.length) {
      console.info('[x-dm-cleanup] data-testid hints (bubble row candidate names):', list);
    } else {
      console.info(
        '[x-dm-cleanup] No hinted data-testid — likely Canvas rendering or CLOSED shadows; DOM cannot automate.',
      );
    }
  }

  function collectAllMessageRoots() {
    let rows = collectClassicMessageRoots();
    let mode = rows.length ? 'classic+deep' : 'none';
    if (!rows.length) {
      rows = collectWildcardMessageRoots();
      mode = rows.length ? 'wildcard+deep' : 'none';
    }
    rows = filterOutermostRowCandidates(rows);
    return { rows, mode };
  }

  /**
   * Likely outgoing bubble — LTR heuristics + testid substring.
   *
   * @param {Element} el
   */
  function isLikelyOutgoingEntry(el) {
    if (el.tagName === 'BUTTON') return true;

    /** @type {Element | null} */
    let cur = el;
    for (let d = 0; d < 18 && cur; d++, cur = cur.parentElement) {
      const st = getComputedStyle(cur);
      if (st.display === 'flex' || st.display === 'inline-flex') {
        const jc = st.justifyContent;
        if (jc === 'flex-end' || jc === 'end') return true;
      }
    }

    if (getComputedStyle(document.documentElement).direction === 'rtl') return false;

    const col = getConversationRootForLayout().getBoundingClientRect();
    if (col.width < 80) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cx = r.left + r.width / 2;
    const mid = col.left + col.width / 2;
    if (cx > mid + 24) return true;

    const t = tidOf(el);
    if (/outgoing|^sent|^user|^self|senderIsViewer|viewer|^msg.*(own|self|sender)/i.test(t)) return true;

    return false;
  }

  function dedupeEntries(entries) {
    const seen = new Set();
    return entries.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  /** Overflow / “more” controls (XChat sometimes skips data-testid="caret"). */
  const MENU_TRIGGER_SELECTORS = [
    '[data-testid="caret"]',
    '[data-testid="messageMoreActions"]',
    '[data-testid="message_overflow"]',
    '[data-testid*="MessageMore"]',
    '[data-testid*="message_more"]',
    'button[aria-label="More actions"]',
    'button[aria-label="More"]',
    '[role="button"][aria-haspopup="menu"]',
  ].join(',');

  /**
   * @param {Element} entry
   * @returns {Element | null}
   */
  function queryInEntryTree(entry, sel) {
    let hit = entry.querySelector(sel);
    if (hit) return hit;
    if (entry instanceof HTMLElement && entry.shadowRoot) {
      hit = entry.shadowRoot.querySelector(sel);
      if (hit) return hit;
    }
    let walker = entry instanceof Element ? entry.parentElement : null;
    for (let d = 0; d < 14 && walker; d++, walker = walker.parentElement) {
      hit = walker.querySelector(sel);
      if (hit) return hit;
      if (walker.shadowRoot) {
        hit = walker.shadowRoot.querySelector(sel);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * Pick menu trigger visually close to outgoing bubble row.
   *
   * @param {Element} entry
   */
  function findMenuTriggerNearEntry(entry) {
    const cr = entry.getBoundingClientRect();
    /** @type {Element | null} */
    let best = null;
    let bestDist = Infinity;

    for (const el of querySelDeep(MENU_TRIGGER_SELECTORS)) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest('[data-testid="SideNav_NewTweet_Button"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;

      /** Prefer triggers on outgoing (right-ish) tail for LTR chat */
      const dx = Math.min(Math.abs(cr.right - r.right), Math.abs(cr.right - r.left));
      const dy = Math.abs(cr.top + cr.height / 2 - (r.top + r.height / 2));
      const dist = dx + dy * 0.75;
      if (dist < bestDist && dx < 120 && dy < 120) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  }

  /**
   * @param {Element} entry
   * @returns {Element | null}
   */
  function findCaretNearEntry(entry) {
    const primary = typeof window.XDM.selectors?.caret === 'string' ? window.XDM.selectors.caret : '[data-testid="caret"]';

    let caret = queryInEntryTree(entry, primary) || queryInEntryTree(entry, '[data-testid="caret"]');

    if (!caret) {
      for (const sel of MENU_TRIGGER_SELECTORS.split(',').map((s) => s.trim())) {
        if (!sel) continue;
        caret = queryInEntryTree(entry, sel);
        if (caret) return caret;
      }
    }

    if (caret) return caret;

    if (entry instanceof HTMLElement && entry.shadowRoot) {
      const inner = entry.shadowRoot.querySelector(MENU_TRIGGER_SELECTORS);
      if (inner) return inner;
    }

    const cell = entry.closest('[data-testid="cellInnerDiv"]');
    if (cell) {
      const c = /** @type {ParentNode & Element} **/ (/** @type {unknown} */ (cell)).querySelector?.(MENU_TRIGGER_SELECTORS);
      if (c) return c;
    }

    return findMenuTriggerNearEntry(entry);
  }

  function findDeleteMenuItem() {
    const candidates = document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]');
    for (const el of candidates) {
      const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const t = raw.split('·')[0].trim();
      if (t === 'Delete' || t === '削除') return el;
      if (/^delete\b/i.test(t)) return el;
    }
    return null;
  }

  function findConfirmButton() {
    const byTestId =
      typeof window.XDM.selectors?.confirmDelete === 'string'
        ? document.querySelector(window.XDM.selectors.confirmDelete)
        : null;
    if (byTestId) return byTestId;
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!dialog) return null;
    for (const el of dialog.querySelectorAll('[role="button"], button')) {
      const t = (el.textContent || '').trim();
      if (t === 'Delete' || t === '削除') return el;
      if (/^delete$/i.test(t)) return el;
    }
    return null;
  }

  function dismissMenus() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function deleteOutgoingDmViaUi() {
    const { rows: allEntries, mode } = collectAllMessageRoots();
    const outgoing = dedupeEntries(allEntries.filter(isLikelyOutgoingEntry));

    console.info(
      '[x-dm-cleanup]',
      `messageRoots count=${allEntries.length} outgoing~=${outgoing.length} (mode=${mode}; ${location.pathname})`,
    );

    if (!allEntries.length) {
      logTestIdHintsWhenEmpty();
      return { result: 'none', detail: 'NO_MESSAGE_ENTRIES' };
    }
    if (!outgoing.length) {
      return { result: 'none', detail: 'NO_OUTGOING_HEURISTIC' };
    }

    const entry = outgoing[0];
    entry.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(200);

    entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    entry.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(120);

    const caret = findCaretNearEntry(entry);
    if (!caret || caret.getAttribute('aria-disabled') === 'true') {
      return { result: 'none', detail: 'NO_CARET' };
    }

    caret.click();
    await sleep(280);

    let deleteItem = findDeleteMenuItem();
    if (!deleteItem) {
      await sleep(400);
      deleteItem = findDeleteMenuItem();
    }
    if (!deleteItem) {
      dismissMenus();
      return { result: 'none', detail: 'NO_DELETE_MENU_ITEM' };
    }

    deleteItem.click();
    await sleep(350);

    const confirm = findConfirmButton();
    if (confirm) {
      confirm.click();
      await sleep(450);
    }

    return { result: 'deleted' };
  }
})();
