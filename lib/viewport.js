window.XDM = window.XDM || {};

/**
 * Scroll helpers: tune once X’s list container is known (selectors / query).
 */
window.XDM.viewport = {
  /**
   * @param {Element} [root]
   * @returns {Element | null}
   */
  findScrollParent(root = document.body) {
    let el = root;
    while (el && el !== document.documentElement) {
      const { overflowY } = getComputedStyle(el);
      const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      if (canScroll) return el;
      el = el.parentElement;
    }
    return document.scrollingElement;
  },

  /**
   * @param {Element} el
   */
  scrollToBottom(el) {
    el.scrollTop = el.scrollHeight;
  },

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },

  /**
   * Wait for DOM churn to settle (loading older messages).
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  waitForQuiet(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let timer = setTimeout(finish, timeoutMs);
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(finish, 400);
      });
      obs.observe(document.body, { childList: true, subtree: true });
      function finish() {
        obs.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
  },
};
