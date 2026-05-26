# 進捗スナップショット（ローカル）

> 会話ベースの実装メモ。最終メンテは **manifest `version` と照合**すること。  
> **現在のバージョン: 0.3.1**（`manifest.json`）

## 目的（スコープ）

- **個人用**：X Web の DM **一覧**から **会話をまとめて削除**する Chrome 拡張（MV3）。
- 操作は手動 UI と同じ：**左一覧の先頭行 → 右クリック → 会話を削除 → 確認する**。
- 公式 API 前提ではなく **DOM / UI 操作**。X / XChat の UI 変更ですぐ壊れうる。

### スコープ外（現行）

- 会話を開いた状態での **個別メッセージの unsend / 削除**（v0.2 まで実験、v0.3 以降は一覧削除が本体）
- Chrome Web Store 公開
- 相手側からの完全削除（プラットフォーム制限）

## できていること（v0.3.1 時点）

| 領域 | 内容 |
|------|------|
| 構造 | `manifest.json` がリポジトリ直下。`popup` / `content` / `lib` / `background`。 |
| 通信 | `XDM_START` は **即時 `sendResponse`**。長時間処理は **`XDM_PROGRESS`** / **`XDM_DONE`**。 |
| `/i/chat`・iframe | **`all_frames: true`**。popup が全フレーム注入後、**会話リンク数・メッセージ数でスコア**し `frameId` を選択。 |
| Shadow | **`lib/dom-deep.js`** が **open Shadow** を跨ぐ。**closed Shadow・Canvas は不可**。 |
| 一覧行 | `/i/chat/数字-数字` リンクを左カラム（x≈68–520px）から収集、**上から順**に処理。 |
| メニュー | **右クリック**（`mousedown` → `contextmenu` + PointerEvent）。失敗時 **行内 ⋯** フォールバック。 |
| 削除項目 | **「会話を削除」** 等（`isDeleteLikeLabel`、deep 探索、クリック位置近傍の popover のみ）。 |
| 確認 | **「確認する」**（`isConfirmLikeLabel`）。見つからなければ **`NO_CONFIRM_BUTTON`**（誤成功しない）。 |
| 再注入 | **`adapter.js` は IIFE + `__XDM_ADAPTER_INITIALIZED__`** で再宣言クラッシュ防止。 |

## 動作確認済み（2026-05）

- `/i/chat` で会話を開いた状態でも、**左一覧先頭**の会話削除フローが完走
- Console: `right-click list row: …` → `clicking confirm: 確認する` → popup `deleted` 増加

## 観測された事象・既知の制限

| 状態 | メモ |
|------|------|
| 合成右クリック | 環境によっては X が無視する。行 ⋯ フォールバックあり。 |
| 他拡張 | Clean-Spam-Link-Tweet / CSLT 等のログは **本拡張外**。 |
| **`listener … asynchronous response`** | 本拡張は即時応答済み。**他拡張**由来が多い。 |
| UI 変更 | ラベル・`data-testid` 変更で `NO_*` に戻りうる。 |

## メンテの指針

1. **`NO_CONVERSATION_ROWS`**: `[x-dm-cleanup] inbox data-testid hints` / `/i/chat/` link count を確認。`collectInboxConversationRows` の左カラム条件を調整。
2. **`NO_DELETE_MENU_ITEM`**: `[x-dm-cleanup] popover labels near click` に **会話を削除** が出るか。`isDeleteLikeLabel` を追加。
3. **`NO_CONFIRM_BUTTON`**: `[x-dm-cleanup] confirm dialog labels seen` を確認。`isConfirmLikeLabel`（例: 確認する）を追加。
4. 変更後 **`chrome://extensions` Reload** + **X タブ F5**。

## バージョン履歴（要約）

| Ver | 内容 |
|-----|------|
| 0.3.1 | **確認する** 対応、`NO_CONFIRM_BUTTON`、confirm deep 探索 |
| 0.3.0 | **一覧先頭 → 右クリック → 会話削除** を本体に（会話 open 時も） |
| 0.2.x | メッセージ吹き出し ⋯ 実験、SideNav / 新規 DM ボタンの誤クリック防止 |
| 0.1.x | MV3 骨格、Shadow deep、メニュー探索の初期版 |

## 関連ドキュメント

- [DESIGN.md](./DESIGN.md) — モジュール分割・メッセージ型。
- [../README.md](../README.md) — 読み込み手順・トラブル表。
