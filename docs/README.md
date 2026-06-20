# docs/ — Tirocinium 公開ドキュメント (GitHub Pages)

`spec/` と実装コードのレビュー結果から作った静的サイト。ビルド不要のプレーン HTML/CSS/JS。

| ページ | 内容 |
|---|---|
| `index.html` | サービスの役割 / 特徴 / 設計のまとめ |
| `graph.html` | ドメイン / 機能 / 連携サービスの関連グラフ (自前 force-directed, canvas) |
| `api.html` | REST + WebSocket API 一覧。トグル展開で詳細・パラメータを確認 |
| `review.html` | 仕様↔コードの対応レビュー |

## データの出どころ

- `assets/graph-data.js` — グラフのノード/エッジ。ドメイン・機能・LUDIARS 連携と実装状況 (status)。
- `assets/api-data.js` — `apps/server/src/routes/*` と `ws/handler.ts` から抽出した API インベントリ。
- `assets/{style.css,graph.js}` — 共有スタイルとグラフ描画。

ルートやパラメータが変わったら `api-data.js` を、ドメイン構成が変わったら `graph-data.js` を更新する。

## 公開

`.github/workflows/pages.yml` が `main` への push (docs/ 変更時) または手動実行で
`docs/` を GitHub Pages にデプロイする。初回はリポジトリ設定の
**Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする必要がある。

ローカル確認は任意の静的サーバで:

```sh
cd docs && python3 -m http.server 8000   # http://localhost:8000
```
