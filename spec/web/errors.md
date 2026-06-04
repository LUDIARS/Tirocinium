# API エラーコード カタログ

Tirocinium server (`apps/server`) の REST/WS が返すエラーコードの正本。
クライアント (desktop / web / Iv 連携) はこのコードで分岐する。**コード文字列は
契約**であり、後方互換を壊さずに増やすことはできるが、既存コードの意味/HTTP
ステータスは変えない。

## レスポンス形式

すべてのエラーは次の JSON 形状で返る (追加フィールドが付くことはある):

```json
{ "error": "<code>" }
```

例: レート制限超過時は `Retry-After` ヘッダ + `{ "error": "rate_limited", "retry_after_sec": 42 }`。

内部例外の詳細 (スタック等) はレスポンスに出さない (`internal` に丸める)。理由は
`apps/server/src/index.ts` の `onError` 参照。

## 一覧

| code | HTTP | 意味 / 発生条件 |
|------|------|----------------|
| `missing_required_fields` | 400 | 必須フィールド欠落 |
| `invalid_action` | 400 | WS / API の action 種別が不正 |
| `invalid_kind` | 400 | リソース種別 (kind) が不正 |
| `invalid_target_kind` | 400 | フィードバック等の対象種別が不正 |
| `unauthorized` | 401 | 認証ヘッダ無し / Cernere 検証前段で失敗 |
| `invalid_token` | 401 | トークン署名/形式が不正 |
| `expired` | 401 | トークン期限切れ |
| `forbidden` | 403 | 認証は通ったが当該リソースへの権限なし |
| `not_found` | 404 | リソースが存在しない (グローバル 404 含む) |
| `not_found_or_not_active` | 404 | 存在しない or 非アクティブなセッション等 |
| `summary_not_yet_generated` | 404 | サマリ未生成 (生成完了まで待つ) |
| `rate_limited` | 429 | レート制限超過。`Retry-After` / `retry_after_sec` 併記 |
| `id_exists` | 409 | 一意制約衝突 (重複 ID) |
| `cannot_cancel` | 409 | 状態遷移上キャンセル不可 |
| `no_turns_to_summarize` | 409 | 要約対象のターンが無い |
| `slot_full` | 409 | 予約スロットが満杯 |
| `internal` | 500 | 予期しない内部エラー (詳細は stderr のみ) |
| `create_failed` | 500 | 作成処理の失敗 |
| `cancel_failed` | 500 | キャンセル処理の失敗 |
| `generation_failed` | 500 | LLM 生成処理の失敗 |
| `reservation_failed` | 500 | 予約確定処理の失敗 |
| `not_implemented` | 501 | 未実装のエンドポイント/分岐 |
| `memoria_upsert_failed` | 502 | Memoria への upsert に失敗 (上流依存) |
| `auth_not_configured` | 503 | Cernere 公開鍵未設定 (本番設定不備) |
| `llm_not_configured` | 503 | LLM バックエンド未設定 (APIキー欠落等) |

## 運用メモ

- 新規コードを足したら本表に 1 行追加する (レビュー時に表との突合を確認)。
- `4xx` はクライアント起因 (リトライしても無駄)、`5xx`/`502`/`503` はサーバ/上流
  起因 (バックオフ + リトライが妥当)。`429` は `Retry-After` に従う。
- 抽出元: `grep -rhoE "error: '[a-z_]+'" apps/server/src`。
