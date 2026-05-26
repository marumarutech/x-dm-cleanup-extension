# x-dm-cleanup-extension

Personal-use Chrome extension to help clean up **your own sent** Direct Messages on X (twitter.com / x.com) via the web UI.

**Not affiliated with X.** For your account only — use at your own risk regarding [X’s rules](https://x.com/rules) and rate limits.

## Load in Chrome (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select **this repository folder** (the one that contains `manifest.json` at the top level), e.g. `D:\github\x-dm-cleanup-extension`

## Project layout

| Path | Role |
|------|------|
| `manifest.json` (repo root) | Unpacked extension root — Chrome must point at this folder |
| `docs/DESIGN.md` | Overview and architecture for implementers |
| `docs/PROGRESS.md` | **現在の進捗・観測メモ・次の調整ポイント**（ローカルスナップショット） |

## 進捗の記録

実装経緯・バージョン整合・TODO の指針は **`docs/PROGRESS.md`** にまとめています（`manifest.json` の `version` と併読）。

## Status

現在 **v0.1.6**（`manifest.json`）。`/i/chat`・iframe・**Shadow（open のみ）**・メニュートリガー複数種を含む実験的アダプタ。

Includes a **best-effort DOM adapter** for classic **`messageEntry`** bubbles, **`DMCompositeMessage`**, and (XChat) **`data-testid` ヒューリスティック**; **`lib/dom-deep.js`** が **open Shadow** を跨ぐ。**`adapter.js` は再注入時の `const` 再宣言を避けるため IIFE + 初期化フラグ**でラップ済み。メニューは **`caret` 以外**（`messageMoreActions` / `More` ラベル / `aria-haspopup` 等）と**座標近傍**も試行。

**v0.1.5**: `dom-deep.js` を manifest の `content_scripts` に正式追加（Shadow 探索が無効だった不具合を修正）。**v0.1.6**: 上記 adapter 再注入クラッシュ修正 + メニュートリガー拡張。

**`NO_MESSAGE_ENTRIES` 時**は Console の **`data-testid hints`** を元に `lib/adapter.js`（IIFE 内）の **`TID_INCLUDE`** を足せる。

**想定ページの例**: `https://x.com/i/chat/`（例: `/i/chat/123456789-987654321` のような会話 ID が `/` で続く）や従来のメッセージ画面。一覧だけでなく**会話が表示されている状態**で使います。

After changing the extension, click **Reload** on `chrome://extensions`. You usually **do not need** to refresh X.

Console の **Clean-Spam-Link-Tweet / CSLT** と **503 / PWA** は本拡張とは別です。**`listener … asynchronous response`** は複数の拡張やスクリプトが同ページで `onMessage` しているときに出ることがあります。確認のときは問題の拡張をオフして試してください。

この拡張は **長い処理を sendResponse で返さず**、`XDM_PROGRESS` / `XDM_DONE` で通知します（チャンネル切断エラーを減らすため）。


| Code | Meaning |
|------|--------|
| `NO_MESSAGE_ENTRIES` | 行ノード無し。**拡張再読み込み + `dom-deep.js` 有無を確認**。F12 で **`data-testid hints`**；Canvas／**closed Shadow** は不可。`/i/chat` は **iframe + `all_frames`**。 |
| `NO_OUTGOING_HEURISTIC` | 吹き出しはあるが送信判定に失敗。Console の `[x-dm-cleanup] messageRoots count=… (mode=…)` を見て **IIFE 内** `isLikelyOutgoingEntry` を調整。 |
| `NO_CARET` | ⋯メニューが取れない。**`MENU_TRIGGER_SELECTORS`** に実 UI の selector を追加。 |
