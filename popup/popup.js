const minDelayEl = document.getElementById('minDelay');
const maxDelayEl = document.getElementById('maxDelay');
const maxDeletesEl = document.getElementById('maxDeletes');
const maxErrorsEl = document.getElementById('maxErrors');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');

const STORAGE_KEYS = ['minDelayMs', 'maxDelayMs', 'maxDeletes', 'maxConsecutiveErrors'];

/** Same order as manifest content_scripts — used for programmatic inject. */
const CONTENT_SCRIPT_FILES = [
  'lib/dom-deep.js',
  'lib/selectors.js',
  'lib/viewport.js',
  'lib/adapter.js',
  'content/orchestrator.js',
];

/** Count DM-ish nodes incl. shadows — keep in sync with adapter heuristics */
const DM_NODE_PROBE_SELECTOR =
  '[data-testid="messageEntry"], [data-testid="DMCompositeMessage"], [data-testid*="essage"], [data-testid*="Bubble"]';

/** @param {string | undefined} url */
function isXdmHost(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const { hostname } = u;
    return (
      hostname === 'x.com' ||
      hostname === 'twitter.com' ||
      hostname === 'www.twitter.com' ||
      hostname === 'mobile.twitter.com' ||
      hostname === 'mobile.x.com'
    );
  } catch {
    return false;
  }
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS);
  if (typeof data.minDelayMs === 'number') minDelayEl.value = String(data.minDelayMs);
  if (typeof data.maxDelayMs === 'number') maxDelayEl.value = String(data.maxDelayMs);
  if (typeof data.maxDeletes === 'number') maxDeletesEl.value = String(data.maxDeletes);
  if (typeof data.maxConsecutiveErrors === 'number') maxErrorsEl.value = String(data.maxConsecutiveErrors);
}

async function saveSettings() {
  await chrome.storage.sync.set({
    minDelayMs: Number(minDelayEl.value),
    maxDelayMs: Number(maxDelayEl.value),
    maxDeletes: Number(maxDeletesEl.value),
    maxConsecutiveErrors: Number(maxErrorsEl.value),
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Inject into every frame (/i/chat is often iframe). Pick frame with most DM-like nodes.
 * @param {number} tabId
 * @returns {Promise<number>} frameId
 */
async function injectAndPickDmFrame(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_SCRIPT_FILES,
  });

  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (sel) => {
      const win = typeof window !== 'undefined' ? window : /** @type {Window | undefined} */ (undefined);
      const deep =
        win &&
        typeof win.XDM === 'object' &&
        win.XDM !== null &&
        typeof win.XDM.deepQueryAll === 'function';
      try {
        if (deep && win) {
          return win.XDM.deepQueryAll(sel).length;
        }
      } catch {
        /** fall through */
      }
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return 0;
      }
    },
    args: [DM_NODE_PROBE_SELECTOR],
  });

  let bestFrameId = 0;
  let bestCount = -1;
  for (const p of probes) {
    const n = typeof p.result === 'number' ? p.result : Number(p.result);
    if (!Number.isFinite(n)) continue;
    if (n > bestCount) {
      bestCount = n;
      bestFrameId = p.frameId;
    }
  }
  return bestFrameId;
}

/**
 * @param {number} tabId
 * @param {{ type: string }} message
 */
async function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, frameId !== undefined ? { frameId } : undefined);
}

async function sendToContent(message) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus('No active tab.');
    return null;
  }
  if (!isXdmHost(tab.url)) {
    setStatus(
      'Active tab must be X: open https://x.com or https://twitter.com (DM conversation), click the tab, then try again.',
    );
    return null;
  }

  try {
    const frameId = await injectAndPickDmFrame(tab.id);
    try {
      await sendToFrame(tab.id, frameId, { type: 'XDM_PING' });
    } catch {
      setStatus(
        'Content script did not respond in the chosen frame. Reload the tab, disable conflicting extensions briefly, retry.',
      );
      return null;
    }

    return await sendToFrame(tab.id, frameId, message);
  } catch (e) {
    setStatus(`Injection / messaging failed.\n\n${String(e?.message ?? e)}`);
    return null;
  }
}

startBtn.addEventListener('click', async () => {
  await saveSettings();
  const minDelayMs = Number(minDelayEl.value);
  const maxDelayMs = Number(maxDelayEl.value);
  const maxDeletes = Number(maxDeletesEl.value);
  const maxConsecutiveErrors = Number(maxErrorsEl.value);

  const res = await sendToContent({
    type: 'XDM_START',
    payload: { minDelayMs, maxDelayMs, maxDeletes, maxConsecutiveErrors },
  });

  if (res?.started) {
    setStatus(
      'Started. Keep this popup open for live progress.\n\n' +
        JSON.stringify(res, null, 2),
    );
  } else if (res) {
    setStatus(JSON.stringify(res, null, 2));
  }
});

stopBtn.addEventListener('click', async () => {
  const res = await sendToContent({ type: 'XDM_STOP' });
  if (res) setStatus(JSON.stringify(res, null, 2));
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'XDM_PROGRESS') {
    setStatus(JSON.stringify(msg.payload, null, 2));
  }
  if (msg?.type === 'XDM_DONE') {
    setStatus(`Finished.\n\n${JSON.stringify(msg.payload ?? {}, null, 2)}`);
  }
});

for (const el of [minDelayEl, maxDelayEl, maxDeletesEl, maxErrorsEl]) {
  el.addEventListener('change', () => saveSettings());
}

loadSettings().catch(() => {});
