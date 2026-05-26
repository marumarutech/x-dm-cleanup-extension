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
    /composer|Composer|Placeholder|Gif|Search|Sticker|Typing|Toolbar|Reaction|Quoted|Follow|timeline|conversationList|participant|Header|Create|NewChat|NewMessage|EmptyState|close|Close|settings|Settings|Attachment|emoji|Emoji|Picker|pinned|Banner|Promo|Upsell|premium|Premium|SideBar|sidebar|DmInbox|InboxSidebar|new-chat|new_chat|dm-new|Filter|Dropdown|Typeahead|TabBar|SettingsButton|SearchBox/i;

  const TID_INCLUDE =
    /essage|ubble|onversation|Dm.*ssage|chat.*ssage|Outgoing|Sent|UserMessage|recipient|messageRow|bubbleRow|message_bubble|^msg/i;

  function tidOf(el) {
    return el.getAttribute('data-testid') || '';
  }

  function collectWildcardMessageRoots() {
    const scope = getChatTranscriptRoot() || getConversationRootForLayout();
    /** @type {Element[]} */
    const pool =
      scope && scope !== document.body && scope !== document.documentElement
        ? [...scope.querySelectorAll('[data-testid]')]
        : querySelDeep('[data-testid]');

    const rows = [];
    for (const el of pool) {
      const t = tidOf(el);
      if (t.length < 3) continue;
      if (TID_EXCLUDE.test(t)) continue;
      if (!TID_INCLUDE.test(t)) continue;
      if (isChatHeaderControl(el)) continue;
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

  function isOpenThread() {
    return /\/i\/chat\/\d+-\d+/.test(location.pathname);
  }

  const CHROME_ANCESTOR =
    '[data-testid="SideNav"], [data-testid="AppTabBar"], header[role="banner"], [data-testid="BottomBar"]';

  function isExcludedChrome(el) {
    if (!(el instanceof Element)) return true;
    if (el.closest(CHROME_ANCESTOR)) return true;
    const nav = el.closest('nav[aria-label], nav[role="navigation"]');
    if (nav?.querySelector('a[href="/home"], a[href="/i/home"]')) return true;
    return false;
  }

  /** Left dock / account overflow — not message ⋯ */
  function isGlobalNavTrigger(el) {
    if (!(el instanceof Element)) return false;
    if (isExcludedChrome(el)) return true;
    const lab = labelFromElement(el);
    if (/その他のメニュー|アカウントメニュー|Account menu|More menu|Show more/i.test(lab)) return true;
    const tid = tidOf(el);
    if (/SideNav|AppTabBar|AccountSwitcher|GlobalNav|NavBar|Logo/i.test(tid)) return true;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return false;
    if (r.right < 96) return true;
    return false;
  }

  /** @param {Element} entry @param {Element} trigger */
  function triggerNearEntry(entry, trigger, pad = 88) {
    const er = entry.getBoundingClientRect();
    const tr = trigger.getBoundingClientRect();
    if (tr.width === 0 || tr.height === 0) return false;
    const tcx = tr.left + tr.width / 2;
    const tcy = tr.top + tr.height / 2;
    return (
      tcx >= er.left - pad &&
      tcx <= er.right + pad &&
      tcy >= er.top - pad &&
      tcy <= er.bottom + pad
    );
  }

  /** @param {Element} el */
  function isSidebarNavOverlayRoot(el) {
    if (!(el instanceof Element)) return false;
    const sample = [];
    el.querySelectorAll('[role="menuitem"], button, [role="button"], li').forEach((node) => {
      const lab = labelFromElement(node);
      if (lab && lab.length < 40) sample.push(lab);
    });
    const blob = sample.slice(0, 10).join('|');
    if (/リスト|コミュニティ|Lists|Communities|Settings and privacy|設定とプライバシー/.test(blob)) {
      if (!/削除|Delete|メッセージ|message|Unsend|unsend/i.test(blob)) return true;
    }
    return false;
  }

  function getChatTranscriptRoot() {
    for (const sel of [
      '[data-testid="DmActivityViewport"]',
      '[data-testid="chat_messages_container"]',
      '[data-testid*="MessageList"]',
      '[data-testid*="messageList"]',
      '[data-testid*="ChatMessageList"]',
    ]) {
      const hit = document.querySelector(sel);
      if (hit instanceof Element) return hit;
    }
    return null;
  }

  /** Header / inbox chrome — not a message bubble or its ⋯ */
  function isChatHeaderControl(el) {
    if (!(el instanceof Element)) return true;
    const tid = tidOf(el);
    if (/new.?chat|NewChat|NewMessage|dm-new|Search|Filter|Header|Toolbar|Typeahead|Settings|Dropdown|Tab|Compose|GifSearch|Recipient/i.test(tid))
      return true;
    const lab = labelFromElement(el);
    if (/^新しいメッセージ$|^新しいチャット$|^New message$|^New chat$|^すべて$|^リクエスト$|^All$|^Requests$/i.test(lab))
      return true;
    if (el.closest('[data-testid*="Header"], [data-testid*="Toolbar"], [data-testid*="NewChat"], [data-testid*="new-chat"]'))
      return true;

    const transcript = getChatTranscriptRoot();
    const r = el.getBoundingClientRect();
    if (r.height === 0) return false;
    if (transcript) {
      const tr = transcript.getBoundingClientRect();
      if (r.bottom < tr.top + 8) return true;
      if (!transcript.contains(el) && r.top < tr.top + 24) return true;
    } else if (r.top < 72) {
      return true;
    }
    return false;
  }

  /** @param {Element} el */
  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** @param {DOMRect} rect @param {{ x: number; y: number } | null} anchor */
  function rectNearAnchor(rect, anchor, maxDist = 360) {
    if (!anchor) return true;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return Math.abs(cx - anchor.x) <= maxDist && Math.abs(cy - anchor.y) <= maxDist;
  }

  function pointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function collectAllMessageRoots() {
    let rows = collectClassicMessageRoots();
    let mode = rows.length ? 'classic+deep' : 'none';
    /** Wildcard hits conversation-list rows on /i/chat/ — only use inside an open thread. */
    if (!rows.length && isOpenThread()) {
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
    if (isChatHeaderControl(el)) return false;

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;

    const transcript = getChatTranscriptRoot();
    if (transcript && !transcript.contains(el)) {
      const tr = transcript.getBoundingClientRect();
      if (r.top < tr.top + 16) return false;
    }

    if (el.tagName === 'BUTTON') {
      const t = tidOf(el);
      if (/new|chat|search|filter|header|toolbar|compose|gif|sticker|send|emoji/i.test(t)) return false;
      if (isChatHeaderControl(el)) return false;
      /** messageEntry outgoing bubbles are often BUTTON */
      if (/message|entry|bubble|composite/i.test(t)) return true;
    }

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
    const cx = r.left + r.width / 2;
    const mid = col.left + col.width / 2;
    if (cx > mid + 24) return true;

    const t = tidOf(el);
    if (/outgoing|^sent|^user|^self|senderIsViewer|viewer|^msg.*(own|self|sender)/i.test(t)) return true;

    return false;
  }

  /** Prefer lowest outgoing row in transcript (recent bubble). */
  function pickOutgoingEntry(candidates) {
    const list = dedupeEntries(candidates.filter(isLikelyOutgoingEntry));
    if (!list.length) return null;
    list.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    return list[0];
  }

  function dedupeEntries(entries) {
    const seen = new Set();
    return entries.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      return true;
    });
  }

  /** Overflow / “more” on a message bubble (avoid bare aria-haspopup — matches SideNav). */
  const MESSAGE_MENU_TRIGGER_SELECTORS = [
    '[data-testid="caret"]',
    '[data-testid="messageMoreActions"]',
    '[data-testid="message_overflow"]',
    '[data-testid*="MessageMore"]',
    '[data-testid*="message_more"]',
    'button[aria-label="More actions"]',
    'button[aria-label="More"]',
    'button[aria-label*="メッセージ"]',
    'button[aria-label*="message" i]',
  ];

  const MENU_TRIGGER_SELECTORS = MESSAGE_MENU_TRIGGER_SELECTORS.join(',');

  /**
   * Search only inside the message row branch — never whole `main` (would hit SideNav ⋯).
   *
   * @param {Element} entry
   * @returns {Element | null}
   */
  function queryInEntryTree(entry, sel) {
    /** @param {ParentNode} root */
    const pick = (root) => {
      let hit = null;
      try {
        hit = root.querySelector(sel);
      } catch {
        return null;
      }
      if (hit instanceof Element && acceptMessageMenuTrigger(hit, entry)) return hit;
      return null;
    };

    let hit = pick(entry);
    if (hit) return hit;

    if (entry instanceof HTMLElement && entry.shadowRoot) {
      hit = pick(entry.shadowRoot);
      if (hit) return hit;
    }

    /** Walk up: query only the child subtree that contains `entry`. */
    let branch = entry;
    for (let d = 0; d < 10 && branch.parentElement; d++) {
      const parent = branch.parentElement;
      for (const sib of parent.children) {
        if (sib === branch || sib.contains(entry)) {
          hit = pick(sib);
          if (hit) return hit;
          if (sib instanceof HTMLElement && sib.shadowRoot) {
            hit = pick(sib.shadowRoot);
            if (hit) return hit;
          }
        }
      }
      branch = parent;
    }

    return null;
  }

  /**
   * Pick menu trigger visually close to the message row (strict — excludes SideNav).
   *
   * @param {Element} entry
   */
  function findMenuTriggerNearEntry(entry) {
    const cr = entry.getBoundingClientRect();
    /** @type {Element | null} */
    let best = null;
    let bestDist = Infinity;

    for (const sel of MESSAGE_MENU_TRIGGER_SELECTORS) {
      for (const el of querySelDeep(sel)) {
        if (!(el instanceof HTMLElement)) continue;
        if (!acceptMessageMenuTrigger(el, entry)) continue;
        const r = el.getBoundingClientRect();
        const dx = Math.min(Math.abs(cr.right - r.right), Math.abs(cr.right - r.left));
        const dy = Math.abs(cr.top + cr.height / 2 - (r.top + r.height / 2));
        const dist = dx + dy * 0.75;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
    }

    /** Last resort: any haspopup menu button glued to this bubble */
    if (!best) {
      for (const el of querySelDeep('[role="button"][aria-haspopup="menu"], button[aria-haspopup="menu"]')) {
        if (!(el instanceof HTMLElement)) continue;
        if (!acceptMessageMenuTrigger(el, entry)) continue;
        const r = el.getBoundingClientRect();
        const dx = Math.min(Math.abs(cr.right - r.right), Math.abs(cr.left - r.left));
        const dy = Math.abs(cr.top + cr.height / 2 - (r.top + r.height / 2));
        if (dx + dy * 0.75 < bestDist) {
          bestDist = dx + dy * 0.75;
          best = el;
        }
      }
    }

    return best;
  }

  /** @param {Element | null} el */
  function isDeniedMenuTrigger(el) {
    if (!(el instanceof Element)) return true;
    return isGlobalNavTrigger(el) || isChatHeaderControl(el);
  }

  /** @param {Element | null} el @param {Element} entry — proximity check for page-wide search */
  function acceptMessageMenuTrigger(el, entry) {
    if (!(el instanceof Element)) return false;
    if (isDeniedMenuTrigger(el)) return false;

    const er = entry.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    if (tr.width === 0 && tr.height === 0) return entry.contains(el);

    const tcy = tr.top + tr.height / 2;
    const ecy = er.top + er.height / 2;
    if (Math.abs(tcy - ecy) > 80) return false;

    return triggerNearEntry(entry, el, 96);
  }

  /** Any ⋯ inside the bubble row — no proximity math (already scoped to entry). */
  function findCaretInsideEntry(entry) {
    /** @type {Element | null} */
    let best = null;
    let bestDy = Infinity;
    const er = entry.getBoundingClientRect();

    /** @param {ParentNode} root */
    const scan = (root) => {
      for (const sel of MESSAGE_MENU_TRIGGER_SELECTORS) {
        let nodes = [];
        try {
          nodes = root.querySelectorAll(sel);
        } catch {
          continue;
        }
        for (const el of nodes) {
          if (!(el instanceof Element)) continue;
          if (isDeniedMenuTrigger(el)) continue;
          const r = el.getBoundingClientRect();
          const dy = Math.abs(r.top + r.height / 2 - (er.top + er.height / 2));
          if (dy < bestDy) {
            bestDy = dy;
            best = el;
          }
        }
      }
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        if (!(el instanceof Element)) continue;
        if (isDeniedMenuTrigger(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 48 || r.height > 48) continue;
        const dy = Math.abs(r.top + r.height / 2 - (er.top + er.height / 2));
        if (dy < bestDy) {
          bestDy = dy;
          best = el;
        }
      }
    };

    scan(entry);
    if (entry instanceof HTMLElement && entry.shadowRoot) scan(entry.shadowRoot);
    const cell = entry.closest('[data-testid="cellInnerDiv"]');
    if (cell instanceof Element) scan(cell);

    return best;
  }

  async function hoverMessageRow(entry) {
    const er = entry.getBoundingClientRect();
    const points = [
      { x: er.left + er.width / 2, y: er.top + er.height / 2 },
      { x: er.right - 6, y: er.top + er.height / 2 },
      { x: er.right + 10, y: er.top + er.height / 2 },
    ];
    for (const p of points) {
      const opts = { bubbles: true, cancelable: true, view: window, clientX: p.x, clientY: p.y };
      document.dispatchEvent(new MouseEvent('mousemove', opts));
      entry.dispatchEvent(new MouseEvent('mouseover', opts));
      entry.dispatchEvent(new MouseEvent('mouseenter', opts));
      entry.dispatchEvent(new PointerEvent('pointerover', opts));
      const hit = document.elementFromPoint(p.x, p.y);
      if (hit instanceof Element) {
        hit.dispatchEvent(new MouseEvent('mouseover', opts));
      }
      await sleep(120);
    }
  }

  /** Probe right edge after hover — X often mounts ⋯ only when pointer is on the row. */
  function findCaretByHitTest(entry) {
    const er = entry.getBoundingClientRect();
    const points = [
      { x: er.right - 4, y: er.top + er.height / 2 },
      { x: er.right + 8, y: er.top + er.height / 2 },
      { x: er.right - 18, y: er.top + er.height / 2 },
    ];
    for (const p of points) {
      let el = document.elementFromPoint(p.x, p.y);
      for (let d = 0; d < 8 && el; d++) {
        if (el instanceof Element && (el.matches('button, [role="button"], [data-testid="caret"]') || tidOf(el) === 'caret')) {
          if (!isDeniedMenuTrigger(el)) return el;
        }
        el = el.parentElement;
      }
    }
    return null;
  }

  function logCaretHintsWhenEmpty(entry) {
    const hints = [];
    for (const el of entry.querySelectorAll('button, [role="button"], [data-testid]')) {
      const t = tidOf(el) || el.getAttribute('aria-label') || el.tagName;
      hints.push(t);
    }
    console.info('[x-dm-cleanup] NO_CARET — controls inside outgoing row:', hints.slice(0, 24));
    const near = [];
    const er = entry.getBoundingClientRect();
    for (const el of querySelDeep('[data-testid="caret"], button[aria-haspopup="menu"]')) {
      if (!(el instanceof Element)) continue;
      const r = el.getBoundingClientRect();
      const dy = Math.abs(r.top + r.height / 2 - (er.top + er.height / 2));
      if (dy < 120) near.push(`${tidOf(el) || labelFromElement(el)} dy=${Math.round(dy)}`);
    }
    if (near.length) console.info('[x-dm-cleanup] carets near row:', near.slice(0, 12));
  }

  /**
   * @param {Element} entry
   * @returns {Element | null}
   */
  function findCaretNearEntry(entry) {
    let caret = findCaretInsideEntry(entry);
    if (caret) return caret;

    const primary = typeof window.XDM.selectors?.caret === 'string' ? window.XDM.selectors.caret : '[data-testid="caret"]';
    caret = queryInEntryTree(entry, primary) || queryInEntryTree(entry, '[data-testid="caret"]');
    if (caret) return caret;

    for (const sel of MENU_TRIGGER_SELECTORS.split(',').map((s) => s.trim())) {
      if (!sel) continue;
      caret = queryInEntryTree(entry, sel);
      if (caret) return caret;
    }

    caret = findCaretByHitTest(entry);
    if (caret) return caret;

    return findMenuTriggerNearEntry(entry);
  }

  /**
   * @param {Element} entry
   * @returns {Promise<{ anchor: { x: number; y: number }; via: 'caret' | 'contextmenu' } | null>}
   */
  async function openMessageActionMenu(entry) {
    await hoverMessageRow(entry);
    let caret = findCaretNearEntry(entry);
    if (!caret) {
      await sleep(350);
      await hoverMessageRow(entry);
      caret = findCaretNearEntry(entry);
    }

    if (caret && caret.getAttribute('aria-disabled') !== 'true') {
      const anchor = centerOf(caret);
      caret.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      caret.click();
      return { anchor, via: 'caret' };
    }

    const er = entry.getBoundingClientRect();
    const anchor = { x: er.right - 12, y: er.top + er.height / 2 };
    entry.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: anchor.x,
        clientY: anchor.y,
      }),
    );
    console.info('[x-dm-cleanup] caret missing — trying contextmenu on bubble', anchor);
    return { anchor, via: 'contextmenu' };
  }

  function menuPrimaryLabel(el) {
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return raw.split('·')[0].split(/\u2219/)[0].trim();
  }

  function isDeleteLikeLabel(label) {
    const t = label.trim();
    if (!t) return false;
    if (/^delete\b/i.test(t)) return true;
    if (/\bdelete\b.*\bmessage\b/i.test(t)) return true;
    if (/^remove\b/i.test(t)) return true;
    if (/remove.*message|^remove\s*for\b/i.test(t)) return true;
    if (/^unsend\b/i.test(t)) return true;
    if (/\bunsend\b.*\bmessage\b/i.test(t)) return true;
    if (/^trash\b/i.test(t)) return true;
    if (/会話を削除|メッセージを削除|メッセージを取り消|メッセージの削除/.test(t)) return true;
    if (/削除/.test(t) && /会話|メッセージ|message|conversation/i.test(t)) return true;
    if (/削除|送信取消|取り消|删掉|删除/.test(t)) return true;
    return false;
  }

  function isCancelLikeLabel(label) {
    const t = label.trim();
    return /^キャンセル$|^cancel$/i.test(t);
  }

  function isConfirmLikeLabel(label) {
    const t = label.trim();
    if (!t || isCancelLikeLabel(t)) return false;
    if (/^confirm$/i.test(t)) return true;
    if (/^confirm\b/i.test(t)) return true;
    if (/^delete$/i.test(t)) return true;
    if (/^確認する$|^確認$|^削除$/.test(t)) return true;
    return false;
  }

  function labelFromElement(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    return menuPrimaryLabel(el);
  }

  /** @param {{ x: number; y: number } | null} [anchor] */
  function findOpenOverlayRoots(anchor = null) {
    const roots = new Set();
    const selectors = [
      '[role="menu"]',
      '[role="listbox"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '[data-testid*="Dropdown"]',
      '[data-testid*="dropdown"]',
      '[data-testid*="Sheet"]',
      '[data-testid*="sheet"]',
      '[data-testid*="Popover"]',
      '[data-testid*="popover"]',
      '[data-testid*="ActionMenu"]',
      '[data-testid*="actionMenu"]',
      '[data-testid*="ContextMenu"]',
    ];
    for (const sel of selectors) {
      querySelDeep(sel).forEach((el) => {
        if (isExcludedChrome(el)) return;
        if (isSidebarNavOverlayRoot(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 24) return;
        if (anchor && !rectNearAnchor(r, anchor, 420) && !pointInRect(anchor.x, anchor.y, r)) return;
        roots.add(el);
      });
    }

    for (const el of querySelDeep('div, nav, section, ul, ol')) {
      if (!(el instanceof HTMLElement)) continue;
      if (isExcludedChrome(el)) continue;
      if (isSidebarNavOverlayRoot(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 36) continue;
      const st = getComputedStyle(el);
      const z = parseInt(st.zIndex, 10);
      if (!Number.isFinite(z) || z < 50) continue;
      if (st.position !== 'fixed' && st.position !== 'absolute') continue;
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') continue;
      if (anchor && !rectNearAnchor(r, anchor, 420) && !pointInRect(anchor.x, anchor.y, r)) continue;
      roots.add(el);
    }

    return [...roots];
  }

  function isLikelyMenuRow(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 16) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.pointerEvents === 'none') return false;
    if (el.matches('button, [role="button"], [role="menuitem"], [role="option"], a[href], [tabindex="0"]'))
      return true;
    if (st.cursor === 'pointer') return true;
    if (el.getAttribute('role') === 'presentation' && el.querySelector('button, [role="button"]')) return true;
    const lab = labelFromElement(el);
    return lab.length > 0 && lab.length < 80;
  }

  /** Prefer the smallest clickable ancestor for a text hit. */
  function clickableTargetFor(el) {
    let cur = el instanceof Element ? el : null;
    for (let d = 0; d < 6 && cur; d++) {
      if (
        cur.matches(
          'button, [role="button"], [role="menuitem"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"], a[href], [tabindex="0"]',
        )
      ) {
        return cur;
      }
      const st = getComputedStyle(cur);
      if (st.cursor === 'pointer') return cur;
      cur = cur.parentElement;
    }
    return el instanceof Element ? el : null;
  }

  /** @param {{ x: number; y: number } | null} [anchor] */
  function collectMenuCandidates(anchor = null) {
    const pool = new Set();
    const rowSelectors = [
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="menuitemcheckbox"]',
      '[role="option"]',
      '[data-testid="deleteMessage"]',
      '[data-testid*="MenuItem"]',
      '[data-testid*="menuItem"]',
    ];

    for (const sel of rowSelectors) {
      querySelDeep(sel).forEach((el) => {
        if (isExcludedChrome(el)) return;
        if (anchor) {
          const r = el.getBoundingClientRect();
          if (!rectNearAnchor(r, anchor, 420)) return;
        }
        pool.add(el);
      });
    }

    for (const root of findOpenOverlayRoots(anchor)) {
      root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li, div, span').forEach((el) => {
        if (isExcludedChrome(el)) return;
        if (isLikelyMenuRow(el)) pool.add(el);
      });
      if (root.shadowRoot) {
        root.shadowRoot
          .querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li, div, span')
          .forEach((el) => {
            if (isLikelyMenuRow(el)) pool.add(el);
          });
      }
    }

    return [...pool];
  }

  /** Last resort: smallest visible node whose label matches delete wording near anchor. */
  function findDeleteByVisibleText(anchor) {
    /** @type {Element | null} */
    let best = null;
    let bestArea = Infinity;

    for (const el of querySelDeep('button, [role="button"], [role="menuitem"], li, div, span')) {
      if (isExcludedChrome(el)) continue;
      const lab = labelFromElement(el);
      if (!isDeleteLikeLabel(lab)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      if (anchor && !rectNearAnchor(r, anchor, 420)) continue;
      const area = r.width * r.height;
      if (area < bestArea) {
        bestArea = area;
        best = clickableTargetFor(el) || el;
      }
    }
    return best;
  }

  function pickDeleteFromCandidates(candidates) {
    for (const el of candidates) {
      if (isDeleteLikeLabel(labelFromElement(el))) return clickableTargetFor(el) || el;
    }
    for (const el of candidates) {
      const tid = tidOf(el);
      if (/delete|remove|trash|unsend/i.test(tid)) return clickableTargetFor(el) || el;
    }
    for (const el of querySelDeep('[data-testid]')) {
      const tid = tidOf(el);
      if (!tid) continue;
      if (/(delete|remove|trash|unsend).*message|(message).*(delete|unsend)|DmDelete|^deleteDm/i.test(tid))
        return clickableTargetFor(el) || el;
    }
    return null;
  }

  /** @param {{ x: number; y: number } | null} [anchor] */
  function logOpenMenuSnippet(anchor = null) {
    const labels = [];
    for (const el of collectMenuCandidates(anchor)) {
      const lab = labelFromElement(el);
      if (lab && lab.length > 0 && lab.length < 120) labels.push(lab);
    }
    const uniq = [...new Set(labels)];
    if (uniq.length) {
      console.info('[x-dm-cleanup] popover labels near click (pick delete-like wording):', uniq.slice(0, 40));
      return;
    }

    const testids = [];
    for (const root of findOpenOverlayRoots(anchor)) {
      root.querySelectorAll('[data-testid]').forEach((el) => {
        const t = tidOf(el);
        if (t && t.length < 100) testids.push(t);
      });
    }
    if (testids.length) {
      console.info('[x-dm-cleanup] popover data-testid hints:', [...new Set(testids)].slice(0, 40));
    } else {
      console.info(
        '[x-dm-cleanup] no popover near click — wrong trigger, closed Shadow, or menu not open yet.',
      );
    }
  }

  /** @param {{ x: number; y: number } | null} [anchor] */
  function findDeleteMenuItem(anchor = null) {
    return pickDeleteFromCandidates(collectMenuCandidates(anchor)) || findDeleteByVisibleText(anchor);
  }

  function findConfirmButton() {
    if (typeof window.XDM.selectors?.confirmDelete === 'string') {
      const sel = window.XDM.selectors.confirmDelete;
      const fromDoc = document.querySelector(sel);
      if (fromDoc) return fromDoc;
      const hits = querySelDeep(sel);
      if (hits.length) return hits[0];
    }

    /** @param {ParentNode} root */
    const scanDialog = (root) => {
      for (const el of root.querySelectorAll('button, [role="button"]')) {
        if (!(el instanceof Element)) continue;
        const lab = labelFromElement(el);
        if (isConfirmLikeLabel(lab)) return clickableTargetFor(el) || el;
      }
      return null;
    };

    for (const dlg of querySelDeep('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      let hit = scanDialog(dlg);
      if (hit) return hit;
      if (dlg instanceof HTMLElement && dlg.shadowRoot) {
        hit = scanDialog(dlg.shadowRoot);
        if (hit) return hit;
      }
    }

    for (const el of querySelDeep('button, [role="button"]')) {
      const lab = labelFromElement(el);
      if (isConfirmLikeLabel(lab)) return clickableTargetFor(el) || el;
    }

    /** Text node may be nested — e.g. red 「確認する」 span inside button */
    for (const el of querySelDeep('[role="dialog"] *, [role="alertdialog"] *, [aria-modal="true"] *')) {
      if (!(el instanceof Element)) continue;
      const lab = labelFromElement(el);
      if (!isConfirmLikeLabel(lab)) continue;
      const click = clickableTargetFor(el);
      if (click) return click;
    }

    return null;
  }

  function logConfirmDialogHints() {
    const labels = [];
    for (const dlg of querySelDeep('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      dlg.querySelectorAll('button, [role="button"], span, div').forEach((el) => {
        const lab = labelFromElement(el);
        if (lab && lab.length < 40) labels.push(lab);
      });
    }
    console.info('[x-dm-cleanup] confirm dialog labels seen:', [...new Set(labels)].slice(0, 20));
  }

  function dismissMenus() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function getDmInboxListRoot() {
    for (const sel of [
      '[data-testid="DMDrawer"]',
      '[data-testid="DmInbox"]',
      '[data-testid="DM inbox"]',
      '[aria-label*="チャット" i]',
      '[aria-label*="Chat" i]',
      '[aria-label*="Messages" i]',
      'main',
    ]) {
      const hit = document.querySelector(sel);
      if (hit instanceof Element) return hit;
    }
    return null;
  }

  function isLikelyInboxHeaderRow(el) {
    const lab = labelFromElement(el);
    if (/^新しい(メッセージ|チャット)|^New (message|chat)|^すべて$|^リクエスト$|^All$|^Requests$/i.test(lab))
      return true;
    const t = tidOf(el);
    return /NewChat|NewMessage|InboxTab|Search|Filter|Header|Toolbar|Compose/i.test(t);
  }

  /** @param {Element} el */
  function isValidConversationRow(el) {
    if (!(el instanceof Element)) return false;
    if (isExcludedChrome(el)) return false;
    if (isLikelyInboxHeaderRow(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 36 || r.height > 220) return false;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 1 || text.length > 500) return false;
    return true;
  }

  function logInboxHintsWhenEmpty() {
    const testids = new Set();
    for (const el of querySelDeep('[data-testid]')) {
      const t = tidOf(el);
      if (t.length > 100) continue;
      if (/chat|dm|conversation|inbox|thread|message|cell/i.test(t)) testids.add(t);
    }
    const links = querySelDeep('a[href*="/i/chat/"]').length;
    console.info('[x-dm-cleanup] inbox data-testid hints:', [...testids].sort().slice(0, 50));
    console.info('[x-dm-cleanup] inbox /i/chat/ link count:', links, `(frame: ${location.pathname})`);
  }

  function sortConversationListRows(rows) {
    return rows
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 96 && r.height >= 36;
      })
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  }

  function collectInboxConversationRows() {
    const rows = new Set();

    /** Most reliable on new X chat: thread links in the left list column. */
    for (const a of querySelDeep('a[href*="/i/chat/"]')) {
      if (!(a instanceof HTMLAnchorElement)) continue;
      const href = a.getAttribute('href') || '';
      if (!/\/i\/chat\/\d+-\d+/.test(href)) continue;
      const r = a.getBoundingClientRect();
      if (r.left < 68 || r.left > 520 || r.height < 16) continue;
      const row =
        a.closest('[data-testid="cellInnerDiv"]') ||
        a.closest('[data-testid="conversation"]') ||
        a.closest('li') ||
        a.closest('[role="link"]') ||
        a.parentElement ||
        a;
      if (row instanceof Element && isValidConversationRow(row)) rows.add(row);
    }

    for (const sel of [
      '[data-testid="conversation"]',
      '[data-testid="DMConversation"]',
      '[data-testid*="Conversation"]',
      '[data-testid*="conversation"]',
      '[data-testid*="ChatThread"]',
      '[data-testid*="chatThread"]',
    ]) {
      querySelDeep(sel).forEach((el) => {
        if (!isValidConversationRow(el)) return;
        const r = el.getBoundingClientRect();
        if (r.left < 68 || r.left > 520) return;
        rows.add(el);
      });
    }

    const listRoot = getDmInboxListRoot();
    if (listRoot) {
      listRoot.querySelectorAll('[data-testid="cellInnerDiv"], li, [role="link"]').forEach((el) => {
        if (!isValidConversationRow(el)) return;
        const r = el.getBoundingClientRect();
        if (r.left < 68 || r.left > 520) return;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 2) return;
        rows.add(el);
      });
    }

    return sortConversationListRows(filterOutermostRowCandidates([...rows]));
  }

  async function rightClickConversationRow(row) {
    const link = row.querySelector('a[href*="/i/chat/"]');
    const target = link instanceof Element ? link : row;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await sleep(240);

    const r = target.getBoundingClientRect();
    const x = r.left + Math.min(Math.max(r.width * 0.45, 24), r.width - 6);
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y) ?? target;

    const label = menuPrimaryLabel(row).replace(/\s+/g, ' ').trim().slice(0, 48);
    console.info('[x-dm-cleanup] right-click list row:', label || '(no text)', `@(${Math.round(x)},${Math.round(y)})`);

    const steps = ['pointerenter', 'pointerover', 'mouseenter', 'mouseover', 'mousedown', 'contextmenu', 'mouseup'];
    for (const type of steps) {
      const down = type === 'mousedown' || type === 'contextmenu';
      const init = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        button: down ? 2 : 0,
        buttons: down ? 2 : 0,
      };
      hit.dispatchEvent(new MouseEvent(type, init));
      if (type === 'contextmenu' && typeof PointerEvent !== 'undefined') {
        hit.dispatchEvent(
          new PointerEvent('contextmenu', { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true }),
        );
      }
      await sleep(45);
    }

    return { x, y };
  }

  /** If contextmenu is ignored (isTrusted), try ⋯ on the list row. */
  async function openConversationRowMenu(row) {
    const anchor = await rightClickConversationRow(row);
    await sleep(500);
    if (findDeleteMenuItem(anchor)) return anchor;

    for (const sel of ['[data-testid="caret"]', '[data-testid="DMConversationMore"]', 'button[aria-haspopup="menu"]']) {
      const btn = row.querySelector(sel);
      if (!(btn instanceof Element)) continue;
      if (isDeniedMenuTrigger(btn)) continue;
      const pt = centerOf(btn);
      btn.click();
      console.info('[x-dm-cleanup] list row ⋯ fallback', tidOf(btn) || sel, pt);
      await sleep(450);
      if (findDeleteMenuItem(pt)) return pt;
    }

    return anchor;
  }

  /**
   * User workflow: top conversation in left list → right-click → 会話を削除 → confirm.
   */
  async function deleteConversationViaInbox() {
    dismissMenus();
    await sleep(120);

    const rows = collectInboxConversationRows();
    console.info('[x-dm-cleanup]', `list mode: conversation rows=${rows.length} (${location.pathname})`);

    if (!rows.length) {
      logInboxHintsWhenEmpty();
      return { result: 'none', detail: 'NO_CONVERSATION_ROWS' };
    }

    const row = rows[0];
    const anchor = await openConversationRowMenu(row);
    await sleep(400);

    let deleteItem = findDeleteMenuItem(anchor);
    if (!deleteItem) {
      await sleep(700);
      deleteItem = findDeleteMenuItem(anchor);
    }
    if (!deleteItem) {
      logOpenMenuSnippet(anchor);
      dismissMenus();
      return { result: 'none', detail: 'NO_DELETE_MENU_ITEM' };
    }

    deleteItem.click();
    await sleep(550);

    let confirm = findConfirmButton();
    if (!confirm) {
      await sleep(400);
      confirm = findConfirmButton();
    }
    if (!confirm) {
      logConfirmDialogHints();
      return { result: 'none', detail: 'NO_CONFIRM_BUTTON' };
    }

    console.info('[x-dm-cleanup] clicking confirm:', labelFromElement(confirm));
    confirm.click();
    await sleep(650);

    return { result: 'deleted', detail: 'CONVERSATION_DELETED' };
  }

  /** Delete top conversation from left list (/i/chat — thread may be open). */
  async function deleteOutgoingDmViaUi() {
    if (location.pathname.startsWith('/i/chat')) {
      return deleteConversationViaInbox();
    }
    return { result: 'none', detail: 'NOT_ON_CHAT_PAGE' };
  }
})();
