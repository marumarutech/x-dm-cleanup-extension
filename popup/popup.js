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

/** Score frames: messages in thread > inbox rows > generic DM nodes */
async function injectAndPickDmFrame(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_SCRIPT_FILES,
  });

  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const deep = typeof window.XDM?.deepQueryAll === 'function';
      /** @param {string} sel */
      const q = (sel) => {
        try {
          return deep ? window.XDM.deepQueryAll(sel).length : document.querySelectorAll(sel).length;
        } catch {
          return 0;
        }
      };

      const messages = q('[data-testid="messageEntry"], [data-testid="DMCompositeMessage"]');
      const convClassic = q('[data-testid="conversation"], [data-testid="DMConversation"]');
      const convLinks = q('a[href*="/i/chat/"]');
      let convWild = 0;
      if (deep) {
        for (const el of window.XDM.deepQueryAll('[data-testid]')) {
          const t = el.getAttribute('data-testid') || '';
          if (/conversation|ChatThread|chatThread|DmThread/i.test(t)) convWild++;
        }
      }
      const cells = q('[data-testid="cellInnerDiv"]');
      const generic = q(
        '[data-testid*="essage"], [data-testid*="Bubble"], [data-testid*="onversation"]',
      );

      const inThread = /\/i\/chat\/\d+-\d+/.test(location.pathname);
      const score =
        messages * 10 +
        (inThread ? messages * 5 : 0) +
        convClassic * 4 +
        convLinks * 3 +
        convWild * 2 +
        Math.min(cells, 40) +
        Math.min(generic, 20);

      return {
        score,
        messages,
        convLinks,
        convClassic,
        cells,
        pathname: location.pathname,
      };
    },
  });

  let bestFrameId = 0;
  let bestScore = -1;
  /** @type {unknown} */
  let bestMeta = null;
  for (const p of probes) {
    const meta = p.result;
    if (!meta || typeof meta !== 'object') continue;
    const score = Number(/** @type {{ score?: number }} */ (meta).score);
    if (!Number.isFinite(score)) continue;
    if (score > bestScore) {
      bestScore = score;
      bestFrameId = p.frameId;
      bestMeta = meta;
    }
  }

  if (bestMeta && bestScore >= 0) {
    console.info('[x-dm-cleanup popup] picked frame', bestFrameId, bestMeta);
  }
  return bestFrameId;
}

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
