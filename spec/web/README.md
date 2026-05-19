# web — フロントエンド構成 + API

Tirocinium クライアントは **Tauri 2 (デスクトップ)** を主、
ブラウザ版 (PWA) は v2 検討。Foundation UI に従う。

---

## ページ構成 (Desktop / PWA 共通)

| Route | 画面 | 説明 |
|---|---|---|
| `/` | Dashboard | 直近セッション、予約状況、未消化評価 |
| `/start` | Session Start | モード選択 + 志望タグ + **面接官ペルソナ選択** + LLM プロファイル確認 |
| `/personas` | Persona Catalog | 面接官 / 受験者 (admin) ペルソナ一覧 + 自作追加 |
| `/sessions/:id/summary` | Session Summary | §3.7 サマリ表示 + ブロック別フィードバック UI |
| `/feedback/history` | Feedback History | 過去フィードバックの一覧、 取消 / 編集 |
| `/admin/ft-runs` | FT loop runs (admin) | FT-like loop の起動・進捗・結果閲覧 |
| `/session/:id` | Session Live | 音声対話画面 + リアルタイム評価 panel |
| `/sessions` | History | 過去面接の一覧 + 評価推移 grad |
| `/training` | Training Data | ES / ポートフォリオ / 過去 Q&A 登録 (実体は Memoria へ POST) |
| `/reservation` | Reservation | 予約枠表示 + 予約 / キャンセル |
| `/settings` | Settings | サーバ URL / Cernere ログイン / 音声デバイス |

---

## 主要コンポーネント

| Component | 役割 |
|---|---|
| `<VoicePanel>` | mic 入力 + VAD 視覚化 + バージイン |
| `<TurnTimeline>` | 過去 turn のチャット風表示 (面接官 / 自分) |
| `<EvalPanel>` | 6 軸のリアルタイムスコア + コメント |
| `<ReservationCalendar>` | 30 分 slot grid、混雑 heatmap |
| `<ModelBadge>` | 現在使用中の LLM 3 機種を示す pill |
| `<PersonaPicker>` | 面接官ペルソナ選択 (stage × role × temperament で絞り込み) |
| `<SummaryView>` | サマリ表示 (headline / highlights / axes / growth / carry-over) |
| `<FeedbackBlock>` | サマリ各ブロック横に accept / reject / edit のアクションバー |
| `<FtRunMonitor>` | FT loop 実行中の turn ごと進捗 + 完了後の critique 比較 |

---

## API エンドポイント

サーバー (`apps/server/`) が提供。`/api/v1/` prefix。
認証: Cernere PASETO ヘッダ `Authorization: Bearer <token>`。

### Session

| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/v1/sessions` | セッション開始要求。成功 = `{session_id, ws_url}`、混雑 = `{reservation_offer: {slot_start, ...}}` |
| GET    | `/api/v1/sessions/:id` | session メタ |
| GET    | `/api/v1/sessions/:id/turns` | turn 履歴 (paged) |
| POST   | `/api/v1/sessions/:id/end` | 強制終了 |
| WS     | `/api/v1/ws/session/:id` | 音声/テキスト 双方向 stream |

### Reservation

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/v1/reservations/slots?from=ISO&hours=24` | 公開 slot 状態 (capacity/used) |
| POST   | `/api/v1/reservations` | `{slot_start}` で予約確定 |
| GET    | `/api/v1/reservations/me` | 自分の予約 |
| DELETE | `/api/v1/reservations/:id` | キャンセル |

### Training

| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/v1/training/refs` | training_data_refs 登録 (本体は Memoria に既に POST 済み前提) |
| GET    | `/api/v1/training/refs` | 自分の参照一覧 |
| DELETE | `/api/v1/training/refs/:id` | 参照削除 |

### Evaluation

| Method | Path | 説明 |
|---|---|---|
| GET    | `/api/v1/sessions/:id/evaluations` | 終了済セッションの評価一覧 |
| GET    | `/api/v1/evaluations/trend?days=30` | 軸別推移 grad |

---

## 状態管理

- Tauri 側は **TanStack Query** + 局所 zustand store。
- session live は WS event を **Yjs-like CRDT 風** に reducer で適用 (turn append のみ)。
- evaluation panel は session WS 内の `eval` フレームを sub topic として subscribe。

---

## WS フレーム (session live)

```ts
type ClientFrame =
  | { kind: 'audio_chunk', pcm: Uint8Array, seq: number }
  | { kind: 'barge_in' }
  | { kind: 'end_turn' }
  | { kind: 'pong', t: number };

type ServerFrame =
  | { kind: 'stt_partial', text: string }
  | { kind: 'stt_final', text: string, turn_no: number }
  | { kind: 'response_token', token: string, turn_no: number }
  | { kind: 'response_end', turn_no: number, text_uri: string }
  | { kind: 'tts_chunk', pcm: Uint8Array, turn_no: number }
  | { kind: 'eval', evaluation: Evaluation }
  | { kind: 'system', code: 'closing' | 'kicked' | 'no_show' };
```
