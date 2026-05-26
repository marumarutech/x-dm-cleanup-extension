# x-dm-cleanup-extension

Personal-use Chrome extension to bulk-delete **DM conversations from your inbox** on X (x.com / twitter.com) via the web UI.

**Not affiliated with X.** For your account only — use at your own risk regarding [X’s rules](https://x.com/rules) and rate limits.

## What it does (v0.3.1)

On `https://x.com/i/chat` (conversation open or not):

1. Find the **top conversation row** in the left list
2. **Right-click** the row (fallback: row ⋯ button)
3. Click **「会話を削除」** (Delete conversation)
4. Click **「確認する」** (Confirm)

Repeats until `maxDeletes` or consecutive errors. Each success increments `deleted` in the popup status.

> **Note:** This removes the conversation **from your inbox** (same as manual UI). Other participants may still see the thread. This is **not** per-message “unsend” inside an open chat.

## Load in Chrome (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select **this repository folder** (the one that contains `manifest.json` at the top level), e.g. `D:\github\x-dm-cleanup-extension`

## Usage

1. Open X → **Messages** (`/i/chat`)
2. Click the extension icon → **Start**
3. Keep the popup open to see `XDM_PROGRESS` / `XDM_DONE` JSON

After changing the extension: **Reload** on `chrome://extensions`, then **F5** on the X tab.

## Project layout

| Path | Role |
|------|------|
| `manifest.json` | Unpacked extension root |
| `popup/` | Start / stop, delays, status |
| `content/orchestrator.js` | Loop, progress broadcast |
| `lib/adapter.js` | DOM steps: list row → menu → confirm |
| `lib/dom-deep.js` | `querySelectorAll` across **open** Shadow roots |
| `docs/DESIGN.md` | Architecture for implementers |
| `docs/PROGRESS.md` | Progress snapshot, troubleshooting (Japanese) |

## Status

**Current version: 0.3.1** (`manifest.json`).

| Version | Highlights |
|---------|------------|
| **0.3.x** | **Primary flow:** left list → right-click → 会話を削除 → 確認する. Frame scoring for iframes. Japanese labels. |
| 0.2.x | Message-bubble experiments (caret / contextmenu); header false-click fixes |
| 0.1.x | MV3 scaffold, Shadow deep query, menu trigger heuristics |

Long runs use **`XDM_PROGRESS` / `XDM_DONE`** (not blocking `sendResponse`) to avoid channel-closed console noise.

## Troubleshooting

| Code | Meaning |
|------|--------|
| `NO_CONVERSATION_ROWS` | Left list rows not found. Reload extension + X tab. Check Console: `[x-dm-cleanup] inbox data-testid hints`. |
| `NO_DELETE_MENU_ITEM` | Context menu opened but 「会話を削除」 not matched. See `[x-dm-cleanup] popover labels near click`. |
| `NO_CONFIRM_BUTTON` | Confirm sheet open but 「確認する」 not clicked. See `[x-dm-cleanup] confirm dialog labels seen`. |
| `NOT_ON_CHAT_PAGE` | Active tab is not `/i/chat`. |

Console noise from **other extensions** (Clean-Spam-Link-Tweet, CSLT) or **`listener … asynchronous response`** is usually unrelated — disable other extensions when debugging.

## Limitations

- **DOM / UI automation** — breaks when X changes the chat UI
- **Open Shadow only** — closed Shadow / Canvas rendering cannot be automated
- Synthetic right-click may be ignored on some builds; adapter falls back to row ⋯ when needed

## 進捗の記録

実装経緯・調整ポイントは **`docs/PROGRESS.md`**（`manifest.json` の `version` と併読）。
