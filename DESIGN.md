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
- 教師データはローカル SQLite に格納。`spec/data/` 参照。
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
- 形は `spec/data` の `weakness_profiles` 表。
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

### 3.5 面接官ペルソナ

面接官は **同じ「AI Sonnet」 でも会話の質が変わる存在** として扱う。
ペルソナはユーザが session 開始時に選ぶ (or 自動推薦)。

#### 3.5.1 ペルソナ属性

| 属性 | 例 | 用途 |
|---|---|---|
| `id` | `hr-warm-40f` | 識別子 |
| `display_name` | 田中 (人事) | UI 表示 |
| `stage` | `hr` / `peer-tech` / `lead-tech` / `final` | RAG 検索 + system prompt 構造 |
| `role_lens` | `planner` / `programmer` / `designer` / `sound` / `any` | 質問題材の絞り込み |
| `temperament` | `warm` / `neutral` / `strict` / `sharp` / `nurturing` | 会話のトーン |
| `pressure` | 1-5 (圧の強さ) | 深掘りの粘り、 沈黙の使い方 |
| `tics` | string[] (口癖 / 質問の癖) | system prompt に埋め込み |
| `bio` | 短い経歴 | 自己紹介の自然さ |
| `evaluation_bias` | JSONB (軸ごとの重み 0.5-1.5) | Opus 評価への重み付け |

#### 3.5.2 system prompt への注入

§3.2 の 4 段重ねに **`(2.5) 面接官ペルソナ`** を挿入し、 5 段重ねへ拡張:

1. 静的 root
2. **面接官ペルソナ** (NEW)
2.5. 弱点プロファイル
3. session 開始時 RAG (role + stage tag を query に追加)
4. GPT-5.5 補正

ペルソナの `pressure` は Sonnet の "聞き返しの粘り" と "沈黙挿入" のパラメータに
変換。 `tics` はそのままシステムプロンプトに転記。

---

### 3.6 受験者ペルソナ (テスト用 / FT loop 用)

**実ユーザではなく**、 想定受験者を AI で模擬する仕組み。
目的: フィードバック loop (§3.8) の駆動 + 一般解 QA seed の調整。

#### 3.6.1 ペルソナ属性

| 属性 | 例 | 用途 |
|---|---|---|
| `id` | `examinee-newgrad-programmer-shy` | 識別子 |
| `display_name` | 中村 (新卒・プログラマ志望) | UI 表示 |
| `background` | 大学/専門/独学/中途 + 経験年数 | 回答の質感 |
| `target_role` | `programmer` 等 | role tag |
| `weakness_axes` | 想定弱点軸 + 弱さ度 0-5 | 模擬回答にバイアスを付与 |
| `strengths` | string[] | 浅い質問は得意な傾向を再現 |
| `speech_style` | `formal` / `casual` / `nervous` / `verbose` | 発話の癖 |
| `intentional_flaws` | string[] (例: 沈黙が長い / 結論先出しが弱い) | テストデータの多様性確保 |

#### 3.6.2 模擬応答

受験者ペルソナを system prompt にした Sonnet/Haiku で「受験者役」 を演じる。
**面接官ペルソナと別 LLM プロセス** で対話させてもよい (cost trade-off で
Haiku 推奨)。 出力は `session_turns.role='user'` として保存される
(local 評価用なので production の reservation_slot は消費しない)。

---

### 3.7 面接サマリ (session 終了時の構造化レポート)

session が `ended` になったタイミング (or 手動 trigger) で Opus に依頼:

| ブロック | 内容 |
|---|---|
| `headline` | 一行サマリ (40 字以内) |
| `highlights` | 印象に残った turn 3-5 個 (turn_no + 1 行コメント) |
| `axes_summary` | 6 軸の最終スコア + EMA との比較 |
| `growth_points` | 改善 hint 3 個 (具体的 / 行動可能) |
| `carry_over` | 次回 session で深掘るべきテーマ 1-2 個 |
| `interviewer_note` | 面接官ペルソナの「総評」 (人格込み) |

サマリは `interview_summaries` 表に保存し、 UI で表示 + 人間フィードバック (§3.8) の
対象になる。

---

### 3.8 人間フィードバック loop

ユーザが **サマリの各ブロックに対して accept / reject / edit** を返す。
これを学習信号として 2 ヶ所に反映:

1. **`weakness_profiles`** の `hint_history` に accept/reject ラベル付き格納
   → 次回以降の Opus に「同じ hint を出さない」 「accept された方向で深掘り」 を伝える
2. **`training_data_refs` の `weight`** を局所的に調整
   → RAG で「accept された頃に引いていた素材」 の score を微増、 reject された
   素材を微減 (係数 ±0.1 程度、 EMA でならす)

フィードバック行為そのものは `human_feedback` 表で履歴を持つ (取消可能性のため)。

> 注: fine-tune は行わない。 これは **prompt + RAG の重み調整による疑似学習** で、
> モデル重みは触らない (§3.2.3 と整合)。

---

### 3.9 FT-like loop (テスト用 / データ生成用)

「fine-tune っぽいループ」 だが、 実体は **半自動の教師データ拡張ループ**:

```
①受験者ペルソナ (§3.6) × 面接官ペルソナ (§3.5) で会話シミュレーション
   ↓
②Opus が turn ごと評価 + 終了時にサマリ (§3.7)
   ↓
③Opus セルフ critique: 「もっと良い答え方を 1 つ」 を生成
   ↓
④人間が最終評価 (各 turn に accept/reject/edit + サマリに同じく)
   ↓
⑤蓄積データ:
   - 受験者ペルソナ単位の rolling weakness baseline
   - 一般解 QA seed の弱点リファクタ候補
   - 弱点プロファイル更新 EMA 係数のチューニング素材
```

CLI: `scripts/ft-loop` で 1 ペルソナ対 = 1 session を起こせる。
人間フィードバックは GUI でやってもよいし、 sample-sessions/ の JSON を手で編集
してもよい。

蓄積データは `data/training/sample-sessions/<date>/<session-id>/` に格納:

```
session-id/
├── conversation.jsonl     # 全 turn
├── opus-evaluations.jsonl # 各評価
├── summary.md             # §3.7 出力
├── ai-critique.md         # §3.9 step③
└── human-feedback.json    # §3.9 step④
```

これにより **学習データセット** が育つ。 直接的な fine-tune はしないが、
Memoria 側 embedding seed の更新や、 一般解 QA seed (data/general/) の改稿に
食わせる。

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

## 5.6 おすすめ企業 + 企業クロール (NEW)

ES から **おすすめ企業** を返す機能 (①) と、 企業ページを **クロールして自動収集** する機能 (②)。
② が集めた企業プール (`companies`) を ① がマッチング対象にする。 詳細は `spec/feature/companies/README.md`。

- ① は ES (request scope or Memoria RAG) + 弱点プロファイル + 志望条件で企業プールを採点し、
  Sonnet で rerank + 理由づけ (鍵なし時は heuristic)。 結果は `company_recommendations` に履歴化。
- ② は `manual` (URL 指定) / `seed-file` (data/companies/seeds.json) ソースで fetch → 抽出
  (Haiku、 失敗時 heuristic) → 正規化 → upsert。 礼節 UA + maxPages 上限 + 逐次。
- ②' **listing クロール** (新卒/ゲーム企業の発見): 設定ソース (job-aggregator/game/seed-list/newgrad-nav、
  newgrad-nav は ToS のため opt-in) の一覧ページを LLM 抽出 → 分類 → `新卒採用あり OR (ゲーム企業 AND 募集あり)`
  のみストック。 **robots.txt 遵守 + 1ドメイン逐次 + Crawl-delay**。
- ②'' **enrichment**: 企業サイトを巡回し IR / 企業理念 / 会社概要 を抽出して `company_profiles` に格納。
- 企業情報は公開情報のため保持可。 ES 本文は保持しない (§6 と整合)。

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
| 企業の**公開情報** (`companies`) / おすすめ**結果** (`company_recommendations`、理由は要約) | ES から導出した本文の逐語コピー |

= Tirocinium 自体は「予約台帳 + 集計 + LLM オーケストレータ」に徹する。

---

## 7. 構成 (実装方針)

詳細は `spec/plan/` だが概要:

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

詳細は `spec/plan/` で確定。

---

## 8. 開く話題 (TODO / 未確定)

- ~~ES / ポートフォリオの永続化先~~ → **Memoria** (Mm) に置き、 embedding も Memoria 側で行う方針 (Memoria 側 API 拡張が必要、 別途調整)
- ローカルモードの軽量モデル選定 (Phi / Llama / Qwen ...)
- サーバーモードの GPU 確保方針 (Cloud GPU API / 自前 / 共有)
- 予約 slot の **長さ** 30 分が妥当か (一面接の実所要時間で再考)
- 課金モデルがあるかどうか
- 多言語対応 (英語面接練習)
