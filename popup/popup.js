const modeEl = document.getElementById('mode');
const modeHintEl = document.getElementById('modeHint');
const minDelayEl = document.getElementById('minDelay');
const maxDelayEl = document.getElementById('maxDelay');
const maxDeletesEl = document.getElementById('maxDeletes');
const maxDeletesLabelEl = document.getElementById('maxDeletesLabel');
const maxErrorsEl = document.getElementById('maxErrors');
const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');

const STORAGE_KEYS = ['mode', 'minDelayMs', 'maxDelayMs', 'maxDeletes', 'maxConsecutiveErrors'];

/** Same order as manifest content_scripts — used for programmatic inject. */
const CONTENT_SCRIPT_FILES = [
  'lib/dom-deep.js',
  'lib/selectors.js',
  'lib/viewport.js',
  'lib/adapter.js',
  'lib/tweet-adapter.js',
  'content/orchestrator.js',
];

const MODE_HINTS = {
  dm:
    '左の一覧で<strong>いちばん上の会話</strong>を右クリック →「会話を削除」→ 確認、を繰り返します。<br />' +
    '<code>/i/chat</code> で Start。',
  tweet:
    'プロフィールまたは <code>/home</code> で Start。<br />' +
    '投稿: ⋯→削除 / リポスト: <strong>緑のリポストボタン</strong>→「ポストを取り消す」。',
};

/** Score frames for DM vs tweet mode */
async function injectAndPickFrame(tabId, mode) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: CONTENT_SCRIPT_FILES,
  });

  const probes = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: (pickMode) => {
      const deep = typeof window.XDM?.deepQueryAll === 'function';
      /** @param {string} sel */
      const q = (sel) => {
        try {
          return deep ? window.XDM.deepQueryAll(sel).length : document.querySelectorAll(sel).length;
        } catch {
          return 0;
        }
      };

      const tweets = q('article[data-testid="tweet"]');
      const primary = q('[data-testid="primaryColumn"]');
      const messages = q('[data-testid="messageEntry"], [data-testid="DMCompositeMessage"]');
      const convLinks = q('a[href*="/i/chat/"]');
      const cells = q('[data-testid="cellInnerDiv"]');

      const inThread = /\/i\/chat\/\d+-\d+/.test(location.pathname);
      const onProfile = /^\/[^/]+(\/(with_replies|media|likes))?\/?$/.test(location.pathname);

      let score = 0;
      if (pickMode === 'tweet') {
        score = tweets * 12 + primary * 5 + (onProfile ? 20 : 0);
      } else {
        score =
          messages * 10 +
          (inThread ? messages * 5 : 0) +
          convLinks * 3 +
          Math.min(cells, 40);
      }

      return {
        score,
        tweets,
        messages,
        convLinks,
        pathname: location.pathname,
        onProfile,
      };
    },
    args: [mode],
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

function updateModeHint() {
  const mode = modeEl.value === 'tweet' ? 'tweet' : 'dm';
  modeHintEl.innerHTML = MODE_HINTS[mode];
  maxDeletesLabelEl.textContent =
    mode === 'tweet' ? 'Max tweets to delete' : 'Max deletes this run';
}

async function loadSettings() {
  const data = await chrome.storage.sync.get(STORAGE_KEYS);
  if (data.mode === 'tweet' || data.mode === 'dm') modeEl.value = data.mode;
  if (typeof data.minDelayMs === 'number') minDelayEl.value = String(data.minDelayMs);
  if (typeof data.maxDelayMs === 'number') maxDelayEl.value = String(data.maxDelayMs);
  if (typeof data.maxDeletes === 'number') maxDeletesEl.value = String(data.maxDeletes);
  if (typeof data.maxConsecutiveErrors === 'number') maxErrorsEl.value = String(data.maxConsecutiveErrors);
  updateModeHint();
}

async function saveSettings() {
  await chrome.storage.sync.set({
    mode: modeEl.value,
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
 * @param {{ type: string; payload?: object }} message
 * @param {'dm' | 'tweet'} mode
 */
async function sendToContent(message, mode) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    setStatus('No active tab.');
    return null;
  }
  if (!isXdmHost(tab.url)) {
    setStatus(
      'Active tab must be X: open https://x.com or https://twitter.com, click the tab, then try again.',
    );
    return null;
  }

  if (mode === 'tweet') {
    try {
      const u = new URL(tab.url);
      const p = u.pathname;
      if (p.startsWith('/i/chat')) {
        setStatus('Tweet mode: open your profile or /home (not /i/chat), then Start.');
        return null;
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const frameId = await injectAndPickFrame(tab.id, mode);
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'XDM_PING' }, { frameId });
    } catch {
      setStatus(
        'Content script did not respond. Reload the tab, disable conflicting extensions briefly, retry.',
      );
      return null;
    }

    return await chrome.tabs.sendMessage(tab.id, message, { frameId });
  } catch (e) {
    setStatus(`Injection / messaging failed.\n\n${String(e?.message ?? e)}`);
    return null;
  }
}

startBtn.addEventListener('click', async () => {
  await saveSettings();
  const mode = modeEl.value === 'tweet' ? 'tweet' : 'dm';
  const minDelayMs = Number(minDelayEl.value);
  const maxDelayMs = Number(maxDelayEl.value);
  const maxDeletes = Number(maxDeletesEl.value);
  const maxConsecutiveErrors = Number(maxErrorsEl.value);

  const res = await sendToContent(
    {
      type: 'XDM_START',
      payload: { mode, minDelayMs, maxDelayMs, maxDeletes, maxConsecutiveErrors },
    },
    mode,
  );

  if (res?.started) {
    setStatus(
      `Started (${mode}). Keep this popup open for live progress.\n\n` +
        JSON.stringify(res, null, 2),
    );
  } else if (res) {
    setStatus(JSON.stringify(res, null, 2));
  }
});

stopBtn.addEventListener('click', async () => {
  const mode = modeEl.value === 'tweet' ? 'tweet' : 'dm';
  const res = await sendToContent({ type: 'XDM_STOP' }, mode);
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

modeEl.addEventListener('change', () => {
  updateModeHint();
  saveSettings().catch(() => {});
});

for (const el of [minDelayEl, maxDelayEl, maxDeletesEl, maxErrorsEl]) {
  el.addEventListener('change', () => saveSettings());
}

loadSettings().catch(() => {});
