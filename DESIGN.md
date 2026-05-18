# Tirocinium — 設計書

面接練習アプリ。本人の ES / ポートフォリオ / 過去面接問答を学習した AI と
音声対話で面接を反復し、Sonnet ストリームで応答しつつ複合 LLM で
ペルソナ評価を返す。

LUDIARS 略称 **Tr**。AIFormat 規約に従って構造化仕様は `spec/` を見る。
本書は機能要件と全体フロー (とくに「予約」) を記述する。

---

## 1. ゴール

- 就活初学者が **本番に近い圧** で面接練習を反復できる。
- 教師データを **本人固有** に持つ (汎用面接 bot ではない)。
- 音声で投げて音声で返す対話を **遅延小** で回す。
- 評価は応答ストリームを邪魔せず、**適度な分量** で別レイヤから返す。

---

## 2. モード

### 2.1 ローカルモード

- ユーザ PC 上のみで完結。ネット切れても動く。
- LLM: 軽量ローカルモデル (ollama 等) で応答生成。STT/TTS も local Whisper / piper を想定。
- 教師データはローカル SQLite に格納。`spec/schema/` 参照。
- 評価層は **OFF または簡易** (応答生成と同じモデルで自己採点)。

### 2.2 サーバーモード

- LUDIARS サーバ群を使い、複合 LLM (GPT-5.5 + Opus + Sonnet) で本番面接体験。
- 認証は **Cernere** (Cr) に委譲。
- 音声経路は **Imperativus** (Iv) を STT/TTS の窓口にする。
- 教師データはローカル → サーバ転送 + LLM の system prompt 化。
  生データの**永続化先は Memoria (Mm) を検討** (本リポは握らない)。

### 2.3 モード切替

- 起動時、サーバ到達性 (`/health`) と認証トークン有効性で自動判定。
- 失敗 → ローカルモードへフォールバック (ユーザ通知)。
- 明示切替 UI もある (設定 / セッション開始ダイアログ)。

---

## 3. 面接 AI (教師データ + ペルソナ)

### 3.1 入力素材

| 素材 | 形式 | 由来 |
|---|---|---|
| ES (履歴書 / エントリーシート) | 構造化 JSON or Markdown | ユーザ提供 |
| ポートフォリオ | URL / PDF / 画像 / コード抜粋 | ユーザ提供 |
| 過去面接の Q&A | timestamp + Q + A + 自己反省 | 過去セッション or 手入力 |
| 志望企業/職種 | tag セット | セッション開始時に指定 |

### 3.2 学習方式 — **RAG + 弱点プロファイル** (案 B 確定)

「本人特化の AI 面接官」 を **fine-tune せず**、 以下 2 段で実現する。

#### 3.2.1 RAG (本人素材の検索注入)

- ES / portfolio / 過去 Q&A は **Memoria** (Mm) 側で永続化 + embedding する。
  - Tirocinium 側は `training_data_refs` で `{kind, memoria_uri, tags, embedding_id}` だけ握り、
    本文も embedding 本体も持たない。
  - Memoria 側に **embedding+search API** を追加してもらう (or 既存利用)。
- セッション開始時、 `(志望企業 tag + 弱点プロファイル top-K 軸)` を query にして
  Memoria の vector search を叩き、 関連素材 top-N を取得。
- 取得した素材を Sonnet の **system prompt RAG ブロック** に注入。

#### 3.2.2 弱点プロファイル (反復で蓄積される本人モデル)

- Opus 評価 (§3.3) の出力を user 単位で EMA (指数移動平均) で集約。
- 6 軸スコアの **平均 + 分散 + 最も低い軸 top-3** + 「改善 hint 履歴」 を保持。
- 形は `spec/schema` の `weakness_profiles` 表。
- セッション開始時、 プロファイルから「鍛えるべき軸」 を抽出して:
  - Sonnet の system prompt 固定部分に注入 (例: 「今回は **論旨明快さ** を特に問う」)
  - GPT-5.5 の深掘り誘導 (§3.3) にも食わせる
- 一度のセッション内では更新しない (session 終了時 / Opus 評価のたびにバッチ更新)。

#### 3.2.3 fine-tune は将来検討

LLM が Anthropic 系 + GPT-5.5 のため、 fine-tune は OpenAI 側でしか不可能。
本人特化に振れすぎると「本番面接の意外性」 を失うため、
v1 では採用しない。 蓄積データが十分溜まり、 ユーザがリクエストしたら検討。

### 3.3 LLM 構成 (サーバーモード)

| 層 | モデル | 役割 |
|---|---|---|
| 応答生成 (主) | **Sonnet** | ユーザ発話に対する面接官の応答。**ストリームで** 即返す。 |
| 質問選定 / 深掘り誘導 | **GPT-5.5** | 5-10 turn ごとに「次に何を聞くべきか」を判断、Sonnet の system prompt を補正 |
| ペルソナ評価 | **Opus** | 一定 turn (デフォルト 5-7 turn) ごとに過去会話を読み、ペルソナを評価 |

- Sonnet 応答は **音声合成と並行** にトークン単位で流す (TTS で被せていく)。
- Opus 評価は **別 channel** で UI 横に出す。応答ストリームを止めない。
- GPT-5.5 は表に出さず、Sonnet の system prompt を裏で書き換える役。

### 3.4 ペルソナ評価の軸

| 軸 | 説明 |
|---|---|
| 主張一貫性 | 過去回答と矛盾していないか |
| 論旨明快さ | 結論先出し / 因果説明の質 |
| 態度・落ち着き | フィラー / 沈黙 / 早口の出現頻度 |
| 自己理解 | 強み・弱みを具体例で語れているか |
| 志望適合 | 志望企業 tag との接続度 |
| 深掘り耐性 | "なぜ?" 連打への持ち堪え |

評価は 0-5 スコア + 一言コメント + 改善 hint で返す。

---

## 4. 音声対話フロー

```
[user voice]
   ↓ (mic capture, VAD で発話区切り)
[STT: Imperativus]
   ↓ (text)
[Tirocinium core]
   ├─ Sonnet 応答ストリーム → TTS → speaker
   └─ Opus 評価 (バックグラウンド) → UI panel
```

- VAD で 発話 → 無音 を検出して 1 turn 確定。
- バージイン (ユーザが応答途中で割って入る) は **Sonnet ストリームを中断** + 新発話を turn として処理。
- 全 turn を `sessions/<id>/turns/` に append-only ログ保存。

---

## 5. 予約フロー (重要)

サーバーモードは GPT-5.5 + Opus + Sonnet を同時に使うため、同時面接数が
**計算資源 (= 同時 LLM コンテキスト数 + GPU 枠)** で制限される。
枠が埋まったときに「待たせる」のではなく、**予約**として時間を確定して帰す。

### 5.1 ゲート判定

セッション開始要求時に、サーバが下記を順にチェック:

1. **認証 OK** か (Cernere)。
2. **同時面接 quota** 内か (per-user + global)。
3. **GPU/LLM プール** に空きがあるか。
4. すべて OK なら即時開始。1 つでも引っ掛かれば **予約フロー** へ。

### 5.2 予約 UI

```
[サーバが今混んでいます]
最短で空く時刻: 2026-05-18 21:30 (約 45 分後)
このまま予約しますか?

[ 21:30 を予約 ]  [ 別の時刻を選ぶ ]  [ ローカルモードで今すぐ ]
```

- 予約は **30 分単位の slot**。
- 1 ユーザ同時保持できる予約は **1 件** (連続予約防止)。
- キャンセル / 時刻変更可。
- 開始 15 分前に Nuntius (Nt) で push 通知。

### 5.3 slot 確保アルゴリズム

- サーバは `reservation_slots` テーブルに 30 分 slot を持つ。
  - `slot_start`, `capacity` (= LLM プール同時数), `used` (確定予約数)。
- ユーザ要求時:
  1. 現在 slot で `used < capacity` なら即時開始 (予約せず session 直行)。
  2. それ以外なら未来 slot を `slot_start ASC` で走査、最初に `used < capacity` の slot を offer。
  3. ユーザが OK したら `used += 1` で確定。
- slot start 時、サーバが対象予約ユーザに WS push + Nuntius 通知。
- 予約ユーザが 5 分以内に開始しなければ slot を解放 (no-show)。

### 5.4 過負荷の段階対応

| 段階 | サーバ負荷 | 動作 |
|---|---|---|
| 平常 | < 70% | 即時開始 |
| 混雑 | 70-95% | 予約 offer (5.2 のフロー) |
| 飽和 | > 95% | 新規受付一時停止、既存セッション保護を優先 |

`飽和` 時は予約 offer も止め、UI に「現在受付停止中。ローカルモードでどうぞ」を出す。

### 5.5 局所サーバー (将来)

予約飽和が常態化したら、ユーザ宅 PC に「半サーバー」を立てて
Cernere 認証 + LLM proxy で複合モデルだけクラウド呼びする mode を検討。
これは v2 以降。

---

## 6. データ責務境界

LUDIARS ルール: 個人データは Cernere 単一情報源、自前 DB に持たない。
Tirocinium が DB に持つもの:

| 持つ | 持たない |
|---|---|
| session メタ (id, user_id, start/end, mode, slot) | ES / ポートフォリオ生データ |
| evaluation score (集計値) | 面接トランスクリプト生データ (Memoria 永続化) |
| reservation slot 状態 | ユーザ氏名 / 連絡先 |
| training_data の **参照** (id + Memoria URI) | training_data 本体 |

= Tirocinium 自体は「予約台帳 + 集計 + LLM オーケストレータ」に徹する。

---

## 7. 構成 (実装方針)

詳細は `spec/code/` だが概要:

```
tirocinium/
  apps/
    desktop/   (Tauri 2 — ローカル/サーバ両対応のクライアント)
    server/    (Hono + WS — サーバーモードの API + LLM proxy + 予約)
  packages/
    voice/     (Iv 連携 + VAD)
    llm/       (複合 LLM オーケストレータ Sonnet/GPT5.5/Opus)
    training/  (教師データの読み込み + embedding)
    reservation/ (予約 slot 計算 + 通知)
  spec/        (AIFormat 構造化仕様)
```

詳細は `spec/code/` で確定。

---

## 8. 開く話題 (TODO / 未確定)

- ~~ES / ポートフォリオの永続化先~~ → **Memoria** (Mm) に置き、 embedding も Memoria 側で行う方針 (Memoria 側 API 拡張が必要、 別途調整)
- ローカルモードの軽量モデル選定 (Phi / Llama / Qwen ...)
- サーバーモードの GPU 確保方針 (Cloud GPU API / 自前 / 共有)
- 予約 slot の **長さ** 30 分が妥当か (一面接の実所要時間で再考)
- 課金モデルがあるかどうか
- 多言語対応 (英語面接練習)
