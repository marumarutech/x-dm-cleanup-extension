# Design: x-dm-cleanup-extension

## Overview

- **Goal:** Personal tool to automate deleting **messages you sent** in X DMs from the web client, reducing manual clicks.
- **Non-goals:** Chrome Web Store release, official X API–first product, removing messages on the recipient’s side (platform limits).
- **Assumption:** X’s DOM changes without notice — isolate all selectors and UI steps behind an **adapter**.

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Popup** | Start / stop, delay & safety settings, status text. Sends commands to the active tab’s content script. |
| **Content script** | Long-running loop: scroll, find messages, invoke adapter → delete one message, respect delay & stop flag. |
| **Background (optional)** | Not required for v1; MV3 service workers sleep. Keep orchestration in the content script. |

### Message flow

```
Popup --chrome.tabs.sendMessage--> Content script
         START { options }
         STOP
Content --runtime.sendMessage--> Popup (optional PROGRESS events)
```

Recommended message types:

- `XDM_START` — payload: `{ minDelayMs, maxDelayMs, maxDeletes, maxConsecutiveErrors }`
- `XDM_STOP`
- `XDM_PROGRESS` (content → popup) — `{ processed, deleted, skipped, errors, lastError? }`

## Module split (extension root = repo root)

1. **`lib/selectors.ts` or `selectors.js`** — All CSS / `data-testid` queries; dated comments when observations were made.
2. **`lib/adapter.js`** — `findOutgoingMessageRoots()`, `openMessageMenu()`, `clickDelete()`, `confirmDelete()` — whatever the current UI needs.
3. **`lib/viewport.js`** — Scroll container detection, scroll-to-load, idle wait (`MutationObserver` + capped timeout).
4. **`content/orchestrator.js`** — Connects messaging, loops, backoff, consecutive-error stop.

## Manifest / permissions (minimal)

- `manifest_version`: 3
- `permissions`: `storage` (settings)
- `host_permissions`: `https://x.com/*`, `https://twitter.com/*`
- `content_scripts`: inject on chat / messages URLs; broad `matches` is OK if guarded by runtime URL checks inside the script.

## Safety defaults (options)

- Random jitter between `minDelayMs` and `maxDelayMs` between actions.
- **Session cap** `maxDeletes` to avoid runaway loops.
- **Stop after `maxConsecutiveErrors`** DOM / click failures.

## Repo boundary

Standalone repo; do not bundle into unrelated apps. Load the repository root (folder containing `manifest.json`) as unpacked in Chrome.
