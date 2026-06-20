# 裏口 (卒業生の自己投稿面) — backdoor

Tirocinium を 3 つの「面」で運用する。 本体/面接は既存、 裏口を本 PR で追加する。

| 面 | 構成 | 認証 | Discord |
|---|---|---|---|
| 本体 | Tr ビュー | なし (企業 DB は public read) | Bot A (`!tr`) |
| 面接 | 認証付き Tr ビュー | Cernere | Bot A (`!tr`) |
| **裏口** | Tr ビュー (本書) | Discord (Bot B のマジックリンク) | **Bot B (`!ob`)** |

Bot A と Bot B は **別 token・別 gateway で別管理**する (`config.discord` / `config.discordBackdoor`)。

## 目的

就職が決まった卒業生が、 次の 3 つを自己投稿できる「裏口」を設ける。

1. **今どの企業にいるか** (`current_company`) — 登録社名と一致すれば企業ページに紐付く
2. **学生に向けたメッセージ** (`message_to_students`) — 本体の「卒業生からのメッセージ」面に掲載
3. **業界内にいる人に向けたメッセージ** (`message_to_industry`) — 裏口面の業界向けフィードに掲載

## 認証 — Cernere ではなく Discord (Bot B)

裏口の本人性は **Discord identity をアンカー**にする (Cernere は使わない。 [[feedback_discutere_auth_via_chat]] と同方針)。

- 卒業生が Bot B で `!ob link` を実行 → Bot B が **ワンタイム link token** を発行し DM でマジックリンクを送る。
- 裏口 view (`/backdoor?token=...`) は起動時に `POST /api/v1/backdoor/auth` で link を **session token** に交換する
  (link は `used_at` で 1 回限り)。 以後の投稿/編集は session token (Bearer) で行う。
- Discord コマンドからも直接投稿できる (`!ob company/students/industry` 等)。 view と Discord の両方から書ける。

## データモデル (migration 019)

- `backdoor_alumni` — 卒業生 1 人 1 行 (PK `id`、 `discord_user_id` UNIQUE)。 3 メッセージ + 掲載フラグ
  (`students_published` / `industry_published`) + `current_company`(_id)。 **本人が同意して書く自己申告**で、
  harvest した PII ではない。 `company_ob_placement`(集計のみ) とは別系統。 本人が編集/削除できる。
- `backdoor_tokens` — `kind='link'`(ワンタイム) / `'session'`(短命) の token。 期限判定は SQL の `now()` に
  依存せず JS の `Date` 比較で行う (SQLite `datetime('now')` と JS ISO の字句順不整合を避ける)。

## API (`/api/v1/backdoor`)

| method | path | 認証 | 用途 |
|---|---|---|---|
| POST | `/auth` | link token | link → session 交換 + エントリ返却 |
| GET | `/me` | session | 自分のエントリ取得 |
| PUT | `/me` | session | 自分のエントリ部分更新 |
| DELETE | `/me` | session | 自分のエントリ削除 |
| GET | `/industry` | session | 業界向けメッセージ + 在籍ロスター (卒業生のみ閲覧) |

`GET /backdoor` は静的 view (`backdoor-viewer/index.html`) を返す。 同一オリジンで API を叩く。

## 本体への接続

`GET /api/v1/resources/ob-messages` は、 裏口で **学生向けに公開** されたエントリ (DB) を、
従来の手編集 `data/general/ob-messages.json` と合成して返す。 本体の「卒業生からのメッセージ」面に出る。

## 公開時の注意

- `appBaseUrl` は裏口 view の到達 URL。 外部公開時は実 URL に設定する。
- 業界向けメッセージ/ロスターは session 認証 (= マジックリンク経由の卒業生) のみ閲覧可能。
- 現状ロスターは「業界向け公開エントリの在籍社名」のみ。 個人特定は本人の自己申告の範囲に限る。
