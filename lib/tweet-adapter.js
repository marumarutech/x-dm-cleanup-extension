/**
 * Profile timeline: topmost item → ⋯ → Delete post OR Undo repost → Confirm (if any).
 */
(function initTweetAdapter() {
  if (window.__XDM_TWEET_ADAPTER_INITIALIZED__) return;
  window.__XDM_TWEET_ADAPTER_INITIALIZED__ = true;

  window.XDM = window.XDM || {};

  async function sleep(ms) {
    return window.XDM.viewport.sleep(ms);
  }

  /** @returns {Element[]} */
  function querySelDeep(sel) {
    if (typeof window.XDM.deepQueryAll === 'function') return window.XDM.deepQueryAll(sel);
    return [...document.querySelectorAll(sel)];
  }

  function labelFromElement(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria) return aria;
    const title = (el.getAttribute('title') || '').trim();
    if (title) return title;
    return (el.textContent || '').replace(/\s+/g, ' ').trim().split('·')[0].trim();
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function rectNearAnchor(r, anchor, pad) {
    return (
      anchor.x >= r.left - pad &&
      anchor.x <= r.right + pad &&
      anchor.y >= r.top - pad &&
      anchor.y <= r.bottom + pad
    );
  }

  function pointInRect(x, y, r) {
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function dismissMenus() {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  function isExcludedChrome(el) {
    if (!(el instanceof Element)) return true;
    if (el.closest('[data-testid="SideNav"], [data-testid="AppTabBar"], header[role="banner"]')) return true;
    return false;
  }

  function isTweetTimelinePage() {
    const p = location.pathname;
    if (!p) return false;
    if (p === '/home' || p.startsWith('/home')) return true;
    if (/^\/(search|explore|notifications|messages|settings|compose|login)/i.test(p)) return false;
    if (p.startsWith('/i/chat')) return false;
    if (p === '/') return true;
    return /^\/[^/]+(\/(with_replies|media|likes|reposts))?\/?$/.test(p);
  }

  function getTimelineRoot() {
    return (
      document.querySelector('[data-testid="primaryColumn"]') ||
      document.querySelector('main[role="main"]') ||
      document.querySelector('main')
    );
  }

  function collectTweetArticles() {
    const root = getTimelineRoot();
    const articles = querySelDeep('article[data-testid="tweet"]');
    const filtered = articles.filter((el) => {
      if (!(el instanceof Element)) return false;
      if (isExcludedChrome(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 40) return false;
      if (r.bottom < 0 || r.top > window.innerHeight + 120) return false;
      if (root && root.contains(el)) return true;
      return r.left > 180 && r.right < window.innerWidth - 40;
    });
    return filtered.sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
    );
  }

  /** Repost row: 「あなたがリポストしました」— undo is on the green repost button, not ⋯ */
  function articleLooksLikeRepost(article) {
    const blob = (article.textContent || '').replace(/\s+/g, ' ');
    if (/あなたがリポスト|You reposted|你已转推|Reposted/i.test(blob)) return true;
    const social = article.querySelector('[data-testid="socialContext"]');
    if (social && /リポスト|repost/i.test(social.textContent || '')) return true;
    const rt = article.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
    if (rt?.getAttribute('aria-pressed') === 'true') return true;
    return false;
  }

  function isUndoRepostLabel(label) {
    const t = label.trim();
    if (!t) return false;
    if (/^ポストを取り消す$/.test(t)) return true;
    if (/ポストを取り消|ポストの取り消し/.test(t)) return true;
    if (/undo\s*repost|unrepost|repostを取り消|リポストを取り消|リポストの取り消し/i.test(t)) return true;
    if (/取り消|undo/i.test(t) && /リポスト|repost|ポスト/i.test(t)) return true;
    return false;
  }

  function isTweetDeleteLabel(label) {
    const t = label.trim();
    if (!t) return false;
    if (isUndoRepostLabel(t)) return false;
    if (/会話|conversation|message|メッセージ/i.test(t) && /削除|delete/i.test(t)) return false;
    if (/ポストを削除|ツイートを削除|投稿を削除|delete post|delete tweet/i.test(t)) return true;
    if (/^削除$|^delete$/i.test(t)) return true;
    if (/削除/.test(t) && /ポスト|ツイート|post|tweet/i.test(t)) return true;
    return false;
  }

  function isConfirmLikeLabel(label) {
    const t = label.trim();
    if (!t || /^キャンセル$|^cancel$/i.test(t)) return false;
    if (/^confirm|^確認する$|^確認$|^削除$/i.test(t)) return true;
    return false;
  }

  function findOpenOverlayRoots(anchor = null) {
    const roots = new Set();
    for (const sel of [
      '[role="menu"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[aria-modal="true"]',
      '[data-testid*="Dropdown"]',
      '[data-testid*="Sheet"]',
    ]) {
      querySelDeep(sel).forEach((el) => {
        if (isExcludedChrome(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 24) return;
        if (anchor && !rectNearAnchor(r, anchor, 480) && !pointInRect(anchor.x, anchor.y, r)) return;
        roots.add(el);
      });
    }
    return [...roots];
  }

  function clickableTargetFor(el) {
    let cur = el instanceof Element ? el : null;
    for (let d = 0; d < 6 && cur; d++) {
      if (cur.matches('button, [role="button"], [role="menuitem"], a[href], [tabindex="0"]')) return cur;
      cur = cur.parentElement;
    }
    return el instanceof Element ? el : null;
  }

  function collectMenuCandidates(anchor = null) {
    const pool = new Set();
    for (const sel of ['[role="menuitem"]', '[role="menuitemradio"]', '[data-testid*="MenuItem"]']) {
      querySelDeep(sel).forEach((el) => {
        if (isExcludedChrome(el)) return;
        if (anchor) {
          const r = el.getBoundingClientRect();
          if (!rectNearAnchor(r, anchor, 480)) return;
        }
        pool.add(el);
      });
    }
    for (const root of findOpenOverlayRoots(anchor)) {
      root.querySelectorAll('button, [role="button"], [role="menuitem"], li, div, span').forEach((el) => {
        if (isExcludedChrome(el)) return;
        const lab = labelFromElement(el);
        if (lab && lab.length < 100) pool.add(el);
      });
    }
    return [...pool];
  }

  /**
   * @returns {{ target: Element; action: 'undo_repost' | 'delete' } | null}
   */
  function findTweetMenuAction(anchor) {
    /** @type {{ target: Element; action: 'undo_repost' | 'delete' } | null} */
    let deleteHit = null;

    const consider = (el) => {
      if (!(el instanceof Element)) return;
      const lab = labelFromElement(el);
      const target = clickableTargetFor(el) || el;
      if (isUndoRepostLabel(lab)) {
        return { target, action: 'undo_repost' };
      }
      if (!deleteHit && isTweetDeleteLabel(lab)) {
        deleteHit = { target, action: 'delete' };
      }
      return null;
    };

    for (const el of collectMenuCandidates(anchor)) {
      const hit = consider(el);
      if (hit) return hit;
    }
    for (const el of querySelDeep('button, [role="button"], [role="menuitem"]')) {
      if (isExcludedChrome(el)) continue;
      const r = el.getBoundingClientRect();
      if (anchor && !rectNearAnchor(r, anchor, 480)) continue;
      const hit = consider(el);
      if (hit) return hit;
    }
    return deleteHit;
  }

  function findConfirmButton() {
    const sel = window.XDM.selectors?.confirmDelete;
    if (sel) {
      const hits = querySelDeep(sel);
      if (hits.length) return hits[0];
    }
    for (const dlg of querySelDeep('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')) {
      for (const el of dlg.querySelectorAll('button, [role="button"]')) {
        if (isConfirmLikeLabel(labelFromElement(el))) return clickableTargetFor(el) || el;
      }
    }
    for (const el of querySelDeep('button, [role="button"]')) {
      if (isConfirmLikeLabel(labelFromElement(el))) return clickableTargetFor(el) || el;
    }
    return null;
  }

  function logMenuHints(anchor) {
    const labels = [];
    for (const el of collectMenuCandidates(anchor)) {
      const lab = labelFromElement(el);
      if (lab && lab.length < 80) labels.push(lab);
    }
    console.info('[x-dm-cleanup tweet] menu labels near click:', [...new Set(labels)].slice(0, 30));
  }

  /** Bottom repost icon (green when you reposted) → 「ポストを取り消す」 menu */
  function findRepostButton(article) {
    const buttons = [
      ...article.querySelectorAll('[data-testid="retweet"], [data-testid="unretweet"]'),
    ].filter((el) => el instanceof Element);

    if (!buttons.length) return null;

    const pressed = buttons.find((el) => el.getAttribute('aria-pressed') === 'true');
    if (pressed) return pressed;

    return buttons.sort(
      (a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top,
    )[0];
  }

  async function openRepostMenu(article) {
    const btn = findRepostButton(article);
    if (!(btn instanceof Element)) return null;

    const anchor = centerOf(btn);
    console.info('[x-dm-cleanup tweet] open repost button menu', labelFromElement(btn) || '[data-testid=retweet]');
    btn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
    btn.click();
    return anchor;
  }

  async function openCaretMenu(article) {
    const caret =
      article.querySelector('[data-testid="caret"]') ||
      article.querySelector('button[aria-haspopup="menu"]') ||
      article.querySelector('[data-testid="Tweet-User-Actions"] [role="button"]');

    if (caret instanceof Element) {
      const anchor = centerOf(caret);
      caret.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
      caret.click();
      return anchor;
    }

    const r = article.getBoundingClientRect();
    const anchor = { x: r.right - 16, y: r.top + 20 };
    article.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: anchor.x,
        clientY: anchor.y,
      }),
    );
    return anchor;
  }

  async function resolveMenuAction(article) {
    const isRepost = articleLooksLikeRepost(article);

    if (isRepost) {
      dismissMenus();
      await sleep(100);
      const rtAnchor = await openRepostMenu(article);
      if (rtAnchor) {
        await sleep(450);
        let action = findTweetMenuAction(rtAnchor);
        if (!action) {
          await sleep(500);
          action = findTweetMenuAction(rtAnchor);
        }
        if (action) return { action, anchor: rtAnchor };
        logMenuHints(rtAnchor);
      }
    }

    dismissMenus();
    await sleep(100);
    const caretAnchor = await openCaretMenu(article);
    await sleep(450);
    let action = findTweetMenuAction(caretAnchor);
    if (!action) {
      await sleep(500);
      action = findTweetMenuAction(caretAnchor);
    }
    if (action) return { action, anchor: caretAnchor };

    logMenuHints(caretAnchor);
    return null;
  }

  /**
   * @returns {Promise<{ result: 'deleted' | 'skipped' | 'none'; detail?: string }>}
   */
  async function deleteTopTweet() {
    if (!isTweetTimelinePage()) {
      return { result: 'none', detail: 'NOT_ON_PROFILE_TIMELINE' };
    }

    dismissMenus();
    await sleep(120);

    const tweets = collectTweetArticles();
    console.info('[x-dm-cleanup tweet]', `articles=${tweets.length} (${location.pathname})`);

    if (!tweets.length) {
      return { result: 'none', detail: 'NO_TWEET_ARTICLES' };
    }

    const article = tweets[0];
    const resolved = await resolveMenuAction(article);
    if (!resolved) {
      dismissMenus();
      return { result: 'none', detail: 'NO_TWEET_ACTION_ITEM' };
    }

    const { action: menuAction, anchor } = resolved;
    console.info(
      '[x-dm-cleanup tweet]',
      menuAction.action === 'undo_repost' ? 'undo repost' : 'delete post',
      labelFromElement(menuAction.target),
    );
    menuAction.target.click();
    await sleep(550);

    if (menuAction.action === 'delete') {
      let confirm = findConfirmButton();
      if (!confirm) {
        await sleep(400);
        confirm = findConfirmButton();
      }
      if (confirm) {
        console.info('[x-dm-cleanup tweet] confirm:', labelFromElement(confirm));
        confirm.click();
        await sleep(650);
      }
    } else {
      await sleep(400);
    }

    return {
      result: 'deleted',
      detail: menuAction.action === 'undo_repost' ? 'REPOST_UNDONE' : 'TWEET_DELETED',
    };
  }

  window.XDM.tweetAdapter = {
    deleteTopTweet,
    isTweetTimelinePage,
    collectTweetArticles,
  };
})();
