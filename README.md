# x-dm-cleanup-extension

個人用 Chrome 拡張。X（x.com / twitter.com）の Web UI を自動操作し、**DM 会話の一括削除** と **タイムライン上からの投稿削除・リポスト取り消し** を行う。

**X 公式とは無関係。** 自分のアカウントのみ、自己責任で利用すること。[利用規約](https://x.com/rules) やレート制限に注意。

**現在のバージョン: 0.4.2**（`manifest.json`）

## できること

| モード | ページ | 動作 |
|--------|--------|------|
| **DM 会話削除** | `/i/chat` | 左一覧の先頭会話 → 右クリック →「会話を削除」→「確認する」を繰り返す |
| **ツイート削除（上から）** | 自分のプロフィール / `/home` など | 上から 1 件ずつ、**投稿削除** または **リポスト取り消し** |

### ツイートモードの内訳

| 種類 | 操作（手動と同じ） |
|------|-------------------|
| **自分の投稿** | 右上 **⋯** →「ポストを削除」など → 確認 |
| **リポスト**（「あなたがリポストしました」） | 下の **緑のリポストボタン** → **「ポストを取り消す」** |

リポストの取り消しは **⋯ メニューには出ない** ため、拡張もリポストボタン経由で開く。

> DM 削除は受信トレイから会話を消すだけ。相手側のスレッドは残る場合がある。チャット内の個別メッセージ unsend ではない。

## インストール（ unpacked ）

1. `chrome://extensions` を開く
2. **デベロッパーモード** を ON
3. **パッケージ化されていない拡張機能を読み込む** → このリポジトリのルート（`manifest.json` があるフォルダ）

例: `D:\github\x-dm-cleanup-extension`

## 使い方

### 共通

1. 対象の X タブを開く
2. 拡張機能アイコン → モードを選ぶ → 件数・遅延を設定 → **Start**
3. 進捗はポップアップに JSON 表示（`XDM_PROGRESS` / `XDM_DONE`）
4. 止めるときは **Stop**

コードを変えたあとは **`chrome://extensions` で再読み込み** → X タブを **F5**。

### DM 会話削除

1. **メッセージ**（`https://x.com/i/chat`）を開く（会話を開いたままでも可）
2. モード **DM 会話削除** → **Start**

### ツイート削除・リポスト取り消し（上から N 件）

1. 次のいずれかを開く  
   - 自分のプロフィール（`https://x.com/YourName`）  
   - **投稿** / **リポスト** タブ  
   - ホーム（`/home`）で自分の投稿・リポストが並んでいる場合
2. モード **ツイート削除（上から）** → **Max tweets to delete** に N → **Start**

1 ループで画面上部の 1 件を処理。投稿なら削除、リポストなら取り消し。混在していても同じ **Start** でよい。

### ポップアップ設定

| 項目 | 説明 |
|------|------|
| Min / Max delay | 各操作の待ち時間（ミリ秒） |
| Max deletes / Max tweets to delete | 1 回の実行で成功させる上限 |
| Stop after consecutive errors | 連続エラーで自動停止 |

## プロジェクト構成

| Path | 役割 |
|------|------|
| `manifest.json` | 拡張のルート |
| `popup/` | UI・設定・フレーム選択・Start/Stop |
| `content/orchestrator.js` | ループ・進捗通知 |
| `lib/adapter.js` | DM 一覧 → 削除 → 確認 |
| `lib/tweet-adapter.js` | ツイート削除・リポスト取り消し |
| `lib/dom-deep.js` | 開いている Shadow DOM 内の query |
| `lib/selectors.js` | 共通セレクタ |
| `lib/viewport.js` | sleep・スクロール補助 |
| `docs/DESIGN.md` | 設計メモ（英語） |
| `docs/PROGRESS.md` | 実装経緯・トラブルシュート（日本語） |

## バージョン履歴

| Version | 内容 |
|---------|------|
| **0.4.2** | リポスト: 緑ボタン →「ポストを取り消す」。ツイート検出改善。`/home` 対応 |
| **0.4.1** | リポスト取り消しラベル対応（⋯ 経由） |
| **0.4.0** | ツイートモード追加。ポップアップで DM / ツイート切替 |
| **0.3.x** | DM: 左一覧 → 右クリック → 会話削除 → 確認。日本語ラベル・iframe スコア |
| 0.2.x | DM バブル操作の実験 |
| 0.1.x | MV3 骨組み |

## トラブルシューティング

### DM モード

| Code | 意味・対処 |
|------|-----------|
| `NO_CONVERSATION_ROWS` | 左一覧の行が見つからない。拡張再読み込み + タブ F5。Console: `[x-dm-cleanup] inbox data-testid hints` |
| `NO_DELETE_MENU_ITEM` | 「会話を削除」が出ない。`[x-dm-cleanup] popover labels near click` を確認 |
| `NO_CONFIRM_BUTTON` | 確認ダイアログの「確認する」が押せない |
| `NOT_ON_CHAT_PAGE` | `/i/chat` 以外で DM モードを実行している |

### ツイートモード

| Code | 意味・対処 |
|------|-----------|
| `NOT_ON_PROFILE_TIMELINE` | プロフィール / ホーム以外で実行している |
| `NO_TWEET_ARTICLES` | `article[data-testid="tweet"]` が見つからない。投稿 or リポストタブを開く・スクロール |
| `NO_TWEET_ACTION_ITEM` | 削除も取り消しも選べない。`[x-dm-cleanup tweet] menu labels near click` を確認 |

リポストで失敗するときは、手動で **緑のリポストボタン** →「ポストを取り消す」が出るか確認する。

### その他

- 他拡張（スパム系など）がメニューを奪うことがある → 一時 OFF で再試行
- Console の `listener … asynchronous response` は通常無害（長時間処理の非同期応答）

## 制限事項

- **DOM 自動操作** — X の UI 変更で動かなくなる可能性がある
- **開いている Shadow DOM のみ** — 閉じた Shadow / Canvas 描画は操作不可
- **大量実行** — アカウント制限のリスクあり。少ない件数から試す
- **他人の投稿** — 削除・取り消しは自分のタイムライン上の自分の操作のみ

## 進捗の記録

実装の経緯・細かい調整は **`docs/PROGRESS.md`** を参照（`manifest.json` の `version` と併読）。
