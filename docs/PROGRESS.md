# 進捗スナップショット（ローカル）

> 会話ベースの実装メモ。最終メンテは **manifest `version` と照合**すること。  
> **現在のバージョン: 0.1.6**（`manifest.json`）

## 目的（スコープ）

- **個人用**：X Web 上で **自分が送信した DM** を削除補助する Chrome 拡張（MV3）。
- 公式 API 前提ではなく **DOM / UI 操作**。X / XChat の UI 変更ですぐ壊れうる。

## できていること

| 領域 | 内容 |
|------|------|
| 構造 | `manifest.json` がリポジトリ直下。`popup` / `content` / `lib` / `background`。 |
| 通信 | `XDM_START` は **即時 `sendResponse`**。長時間処理は **`XDM_PROGRESS`** / **`XDM_DONE`** で通知。 |
| `/i/chat`・iframe | **`all_frames: true`**。popup が **全フレーム注入後、DM らしいノード数が多い `frameId` に `sendMessage`**。 |
| Shadow | **`lib/dom-deep.js`** が **open Shadow** を跨いで `querySelectorAll`。**closed Shadow・Canvas は不可**。 |
| DM 行の探索 | **`messageEntry` / `DMCompositeMessage`** → 無ければ **`data-testid` ヒューリスティック**（`TID_*`）、`deep` で列挙。 |
| メニュー | **`caret` だけでなく** `messageMoreActions` / `aria-label="More"` / `aria-haspopup="menu"` 等を試行。**座標による近傍**も使用。 |
| 再注入 | **`adapter.js` は IIFE + `__XDM_ADAPTER_INITIALIZED__`** で、`executeScript` 再注入時の **`const` 再宣言クラッシュを防止**。 |

## 観測された事象・未完了

| 状態 | メモ |
|------|------|
| `messageRoots` 検出 | **wildcard+deep** で複数ヒットすることは確認済み（例: `/i/chat/…`）。 |
| `NO_CARET` | XChat で **⋯ が `caret` と一致しない**ケースへの対処を増やしているが、**実 DOM に合わせた追記が必要な場合あり**（Console / Elements で実ボタンの `data-testid` を取る）。 |
| 他拡張 | Clean-Spam-Link-Tweet / CSLT 等のコンソールログは **本拡張外**。切り分けでオフ推奨。 |
| **`listener … asynchronous response`** | 本拡張は即時応答済み。**他拡張**やページスクリプト由来のことが多い。 |

## メンテの指針（次を触るとき）

1. **`NO_MESSAGE_ENTRIES`**: `[x-dm-cleanup] data-testid hints` を見て、吹き出しコンテナっぽい名前を **`lib/adapter.js`（IIFE 内）の `TID_INCLUDE`** に追加。
2. **`NO_CARET`**: 同様に **`MENU_TRIGGER_SELECTORS`** に、その UI の⋯ボタンの selector を追加。
3. **`NO_DELETE_MENU_ITEM` / 削除不可**: メニューラベル文言（多言語・`role`）や確認シートの `data-testid` を確認し `findDeleteMenuItem` / `findConfirmButton` を調整。
4. コード変更後 **`chrome://extensions` で Reload** と **X タブ F5**。`adapter` は初期化フラグのためタブリロード推奨。

## 関連ドキュメント

- [DESIGN.md](./DESIGN.md) — モジュール分割・メッセージ型の狙い。
- [../README.md](../README.md) — 読み込み手順・トラブル表。
