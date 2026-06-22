# 裏口 (卒業生の自己投稿面) — backdoor

Tirocinium を 3 つの「面」で運用する。 認証は 3 面とも Cernere に統一する。

| 面 | 構成 | 認証 | Discord |
|---|---|---|---|
| 本体 | Tr ビュー | なし (企業 DB は public read) | Bot A (`!tr`) |
| 面接 | 認証付き Tr ビュー | Cernere | Bot A (`!tr`) |
| **裏口** | Tr ビュー (本書、`/backdoor`) | **Cernere** | — |

> 旧仕様では裏口を Discord Bot B のマジックリンクで認証していたが、 認証を Cernere に一本化し
> Bot B・`backdoor_tokens`・`/auth` 交換を撤去した (migration 021)。 OB の自己投稿は裏口 view から行う。

## 目的

就職が決まった卒業生/OB が、 次を自己投稿できる「裏口」を設ける。

1. **今どの企業にいるか** (`current_company`) — 登録社名と一致すれば企業ページに紐付く
2. **学生に向けたメッセージ** (`message_to_students`) — 本体の「卒業生からのメッセージ」面に掲載
3. **業界内にいる人に向けたメッセージ** (`message_to_industry`) — 裏口面の業界向けフィードに掲載
4. **OB 求人投稿** / **ES 添削相談の引き受け** — `ob_job_postings` / `ob_es_requests`

## 認証 — Cernere に統一

裏口の本人性は **Cernere の sub をアンカー**にする (本体/面接と同じ `cernereAuth`、 PASETO Bearer)。

- 裏口 view (`/backdoor`) は `cernere_token` (localStorage、 es-requests / 面接 view と共有) を Bearer に載せて
  `/api/v1/backdoor/*` を叩く。 トークンが無い/失効していれば「ログインが必要」ゲートを出す。
- マジックリンク (`?token=...` → `/auth` 交換) は廃止。 Discord からの投稿経路 (Bot B `!ob`) も廃止。
- 個人情報 / ES 本文 / 面接情報は Tr に保存しない (責務は Cernere)。 Tr が持つのは自己申告エントリ +
  OB 求人 + ES 相談の**マッチング履歴**のみ。

## データモデル (migration 019 + 021)

- `backdoor_alumni` — 卒業生/OB 1 人 1 行 (PK `id`、 `cernere_user_id` UNIQUE)。 3 メッセージ + 掲載フラグ
  (`students_published` / `industry_published`) + `current_company`(_id)。 **本人が同意して書く自己申告**で、
  harvest した PII ではない。 `company_ob_placement`(集計のみ) とは別系統。 本人が編集/削除できる。
- `ob_job_postings.posted_by_cernere_user_id` / `ob_es_requests.matched_ob_cernere_user_id` — OB アンカーも
  Cernere sub。 migration 021 で `*_discord_user_id` から改名した。
- `backdoor_tokens` は migration 021 で撤去 (マジックリンク廃止)。

## API (`/api/v1/backdoor`)

すべて Cernere 認証 (Bearer)。 `c.get('user').id` が本人の Cernere sub。

| method | path | 用途 |
|---|---|---|
| GET | `/me` | 自分のエントリ取得 (未登録なら null) |
| PUT | `/me` | 自分のエントリ部分更新 |
| DELETE | `/me` | 自分のエントリ削除 |
| GET | `/industry` | 業界向けメッセージ + 在籍ロスター (卒業生のみ閲覧) |
| GET/POST/PUT/DELETE | `/job-postings(/:id\|/mine)` | OB 求人の閲覧/投稿/更新/削除 |
| GET | `/es-requests` | 自社宛て ES 相談リクエスト一覧 |
| POST | `/es-requests/:id/accept` | ES 相談を引き受ける → 学生へ Nuntius 通知 |

`GET /backdoor` は静的 view (`backdoor-viewer/index.html`) を返す。 同一オリジンで API を叩く。

## 通知 — Nuntius

OB への到達通知は Discord DM ではなく **Nuntius** で行う (Cernere user id 宛)。

- 学生が ES 相談を申し込む → 対象企業の OB 全員へ Nuntius push。
- OB が引き受ける → 学生本人へ Nuntius push (引き受けた OB 名 + 任意の連絡先)。

## 本体への接続

`GET /api/v1/resources/ob-messages` は、 裏口で **学生向けに公開** されたエントリ (DB) を、
従来の手編集 `data/general/ob-messages.json` と合成して返す。 本体の「卒業生からのメッセージ」面に出る。

## 公開時の注意

- 業界向けメッセージ/ロスターは Cernere 認証済ユーザのみ閲覧可能。
- 現状ロスターは「業界向け公開エントリの在籍社名」のみ。 個人特定は本人の自己申告の範囲に限る。
