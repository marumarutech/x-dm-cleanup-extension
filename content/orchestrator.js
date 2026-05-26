(function () {
  /** Avoid duplicate listeners when popup injects after a tab was open pre-install. */
  if (window.__XDM_CLEANUP_ORCHESTRATOR__) return;
  window.__XDM_CLEANUP_ORCHESTRATOR__ = true;

  const state = {
    running: false,
    abort: false,
  };

  function randomDelay(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(lo + Math.random() * (hi - lo + 1));
  }

  function safeBroadcast(message) {
    void chrome.runtime.sendMessage(message).catch(() => {
      /** No popup/background listener — ignore. */
    });
  }

  async function runLoop(payload) {
    const {
      minDelayMs,
      maxDelayMs,
      maxDeletes,
      maxConsecutiveErrors,
    } = payload;

    state.running = true;
    state.abort = false;

    const stats = {
      processed: 0,
      deleted: 0,
      skipped: 0,
      errors: 0,
      lastError: null,
    };

    let consecutiveErrors = 0;

    while (!state.abort && stats.deleted < maxDeletes && consecutiveErrors < maxConsecutiveErrors) {
      stats.processed++;

      /** @type {{ result: string; detail?: string } | undefined} */
      let step;
      try {
        step = await window.XDM.adapter.deleteOneSentMessage();
      } catch (e) {
        consecutiveErrors++;
        stats.errors++;
        stats.lastError = String(e?.message ?? e);
        await window.XDM.viewport.sleep(randomDelay(minDelayMs, maxDelayMs));
        continue;
      }

      if (step.result === 'deleted') {
        consecutiveErrors = 0;
        stats.deleted++;
      } else if (step.result === 'skipped') {
        consecutiveErrors = 0;
        stats.skipped++;
      } else if (step.detail === 'NOT_IMPLEMENTED') {
        stats.lastError =
          'Adapter not implemented — edit lib/adapter.js (see docs/DESIGN.md)';
        state.abort = true;
        break;
      } else {
        consecutiveErrors++;
        stats.errors++;
        stats.lastError = step.detail ?? step.result;
        const scroller = window.XDM.viewport.findScrollParent();
        if (scroller) {
          window.XDM.viewport.scrollToBottom(scroller);
          await window.XDM.viewport.waitForQuiet(2500);
        }
      }

      safeBroadcast({
        type: 'XDM_PROGRESS',
        payload: { ...stats },
      });

      await window.XDM.viewport.sleep(randomDelay(minDelayMs, maxDelayMs));
    }

    state.running = false;
    const result = {
      done: true,
      aborted: state.abort,
      stats,
    };
    safeBroadcast({ type: 'XDM_DONE', payload: result });
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'XDM_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === 'XDM_STOP') {
      state.abort = true;
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type !== 'XDM_START') return false;

    if (state.running) {
      sendResponse({ ok: false, error: 'ALREADY_RUNNING' });
      return false;
    }

    const payload = msg.payload ?? {};
    const minDelayMs = Number(payload.minDelayMs) || 800;
    const maxDelayMs = Number(payload.maxDelayMs) || 2000;
    const maxDeletes = Number(payload.maxDeletes) || 50;
    const maxConsecutiveErrors = Number(payload.maxConsecutiveErrors) || 5;

    /** Reply immediately — long runs must not hold sendResponse (channel closes → console error). */
    sendResponse({ ok: true, started: true });
    void runLoop({
      minDelayMs,
      maxDelayMs,
      maxDeletes,
      maxConsecutiveErrors,
    });
    return false;
  });
})();
