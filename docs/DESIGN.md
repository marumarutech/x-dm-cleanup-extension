# Design: x-dm-cleanup-extension

## Overview

- **Goal:** Personal tool to automate **deleting DM conversations from your X inbox** (left list → context menu → confirm), reducing repetitive clicks.
- **Non-goals:** Chrome Web Store release, official X API–first product, deleting messages on the recipient’s side, per-message unsend inside an open thread (experimental code removed from the default path in v0.3).
- **Assumption:** X’s DOM changes without notice — isolate all selectors and UI steps behind an **adapter** (`lib/adapter.js`).

## User-visible flow (v0.3.1)

```
/i/chat page (thread may be open)
  → collect top conversation row in left list
  → right-click row (or row ⋯ fallback)
  → click 「会話を削除」 / Delete conversation
  → click 「確認する」 / Confirm
  → repeat (orchestrator loop)
```

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Popup** | Start / stop, delay & safety settings, status JSON. Injects scripts into all frames, picks best `frameId`, sends `XDM_START`. |
| **Content script (`orchestrator.js`)** | Long-running loop: call adapter once per iteration, respect delay & stop flag, broadcast progress. |
| **Adapter (`lib/adapter.js`)** | All X-specific DOM: list rows, context menu, delete item, confirm button. |
| **Deep DOM (`dom-deep.js`)** | `querySelectorAll` across open Shadow roots. |
| **Background** | MV3 service worker present; orchestration stays in content script. |

### Message flow

```
Popup --chrome.tabs.sendMessage(frameId)--> Content script
         XDM_START { minDelayMs, maxDelayMs, maxDeletes, maxConsecutiveErrors }
         XDM_STOP
Content --runtime.sendMessage--> Popup
         XDM_PROGRESS { processed, deleted, skipped, errors, lastError? }
         XDM_DONE { done, aborted, stats }
```

- **`XDM_START`:** popup replies immediately `{ started: true }`; work continues asynchronously.
- **`XDM_STOP`:** sets abort flag on orchestrator.

## Module split (extension root = repo root)

1. **`lib/selectors.js`** — Shared CSS / `data-testid` constants (e.g. `confirmDelete`).
2. **`lib/adapter.js`** — `collectInboxConversationRows()`, `rightClickConversationRow()`, `findDeleteMenuItem()`, `findConfirmButton()`, entrypoint `deleteOutgoingDmViaUi()` → `deleteConversationViaInbox()`.
3. **`lib/viewport.js`** — `sleep()`, scroll helpers (reserved for future load-more).
4. **`content/orchestrator.js`** — Message listener, loop, consecutive-error cap.
5. **`popup/popup.js`** — Settings, frame probe scoring (messages + `/i/chat/` links + cells).

## Adapter design notes

### List row detection

- Prefer `a[href*="/i/chat/数字-数字"]` in the left column (roughly x 68–520px).
- Sort by `getBoundingClientRect().top` — process **topmost** row each iteration.
- Exclude header chrome: 「新しいメッセージ」, 「すべて」, SideNav, etc.

### Menu open

- Primary: synthetic **context menu** on the row link center.
- Fallback: `[data-testid="caret"]` / `aria-haspopup="menu"` on the row only (never global SideNav / `dm-new-chat-button`).

### Delete & confirm labels

- Delete item: `isDeleteLikeLabel` — includes **会話を削除**, Delete message, unsend, etc.
- Confirm: `isConfirmLikeLabel` — includes **確認する**, Confirm, 削除; excludes **キャンセル**.
- Popover search is **scoped near click anchor** to avoid matching the left app menu (Lists, Communities, …).

### Adapter result shape

```js
{ result: 'deleted' | 'skipped' | 'none', detail?: string }
```

Details include `CONVERSATION_DELETED`, `NO_CONVERSATION_ROWS`, `NO_DELETE_MENU_ITEM`, `NO_CONFIRM_BUTTON`, `NOT_ON_CHAT_PAGE`.

## Manifest / permissions

- `manifest_version`: 3
- `permissions`: `storage`, `activeTab`, `scripting`
- `host_permissions`: `https://x.com/*`, `https://twitter.com/*`, mobile hosts
- `content_scripts`: all X URLs, **`all_frames: true`**, includes `dom-deep.js` before `adapter.js`

## Safety defaults (popup options)

- Random jitter between `minDelayMs` and `maxDelayMs` between iterations.
- **`maxDeletes`** cap per run.
- **`maxConsecutiveErrors`** stop after repeated DOM failures.

## Repo boundary

Standalone repo; load the folder containing `manifest.json` as unpacked in Chrome. Do not bundle into unrelated apps.
