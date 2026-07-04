# 面接官エンジン — ランタイムオーケストレーション

面接 1 セッションを駆動する**実行時エンジン**の全体像。turn パイプライン・複合 LLM の役割分担・
system prompt の積層・劣化(degradation)・セッション跨ぎ学習をここで定義する。

- フェーズ状態機 / 弁証法サイクルの**理論と遷移規則**は [`dialectic-engine.md`](./dialectic-engine.md)。
- モデル割当 (ModelRole / プロファイル) は [`model-profiles.md`](./model-profiles.md)。
- 決定的コア / Brain 境界 / 学習データ接地 (再現性設計) は
  [`interviewer-reproduction.md`](./interviewer-reproduction.md)。
- 本書はそれらを**配線して 1 ターンを回す**部分 (`apps/server/src/ws/session-runtime.ts`) を扱う。

---

## 1. 実体と責務

| 層 | 場所 | 役割 |
|---|---|---|
| ランタイム | `apps/server/src/ws/session-runtime.ts` (`SessionRuntime`) | WS 駆動の turn ループ。状態保持・LLM 配線・永続化 |
| プロンプト構築 | `packages/llm/src/response.ts` (`buildSystemPrompt`) | system prompt の積層 (§4) |
| フェーズ機 | `packages/llm/src/phase.ts` (`nextPhase`) | 進行の純関数 (Macro)。詳細は dialectic-engine |
| 判定 | `packages/llm/src/judge.ts` (`assessAnswer`) | 回答→フェーズ signal (Micro) |
| 補正 | `packages/llm/src/refine.ts` (`refine`) | 次に深掘る論点 (GPT) |
| 評価 | `packages/llm/src/evaluator.ts` (`evaluate`) | 6 軸評価 (Opus) → 弱点 EMA |

`SessionRuntime` は 1 WS 接続 = 1 セッションに対応し、`turns` / `phaseState` / `weakTop3` /
`ragBlock` / `refineBlock` / `latestSignals` をインメモリ状態として持つ。

---

## 2. 複合 LLM の役割分担

| 役割 | モデル(既定) | 起動契機 | 知覚レイテンシ | 効果 |
|---|---|---|---|---|
| 応答生成 | Sonnet (`streamResponse`) | 毎ターン | **クリティカルパス** | 面接官発話を token stream (TTS と並走) |
| リアルタイム判定 | Haiku (`assessAnswer`) | 応答送信**後** | 増えない (背景) | `synthesisReached`/`contradictionOpen`/`followupHint` |
| 深掘り論点 | GPT (`refine`) | **フェーズ遷移時** | 増えない (背景) | 「次に深掘るべき論点」を生成 |
| ペルソナ評価 | Opus (`evaluate`) | **5 turn ごと** | 増えない (背景) | 6 軸採点 → `evaluations` + 弱点 EMA |

設計原則: **応答ストリームを止めるのは Sonnet だけ**。judge / refine / evaluate は
`void ...Background()` で発火し、知覚レイテンシに乗せない (RULE_CODE §7)。

---

## 3. turn パイプライン

```
[user 発話] ── stt_final / STT(Iv) final ──▶ handleUserTurn
  ① 直前の面接官質問を控える (judge 用)
  ② user turn を turns に push + session_turns へ永続化 + stt_final を WS echo
  ▼
generateInterviewerTurn
  ③ buildSystemPrompt(interviewer, weakTop3, ragBlock, refineBlock, phase)
  ④ Sonnet を stream → response_token を逐次 WS 送信 → response_end
  ⑤ interviewer turn を turns に push + 永続化
  ▼
[応答確定後・並行]
  ⑥ judge(Haiku): 直前 Q&A を評価 → latestSignals 更新 / followupHint→refineBlock
  ⑦ advanceInterviewerPhase:
       - nextPhase(phaseState, latestSignals) で遷移
       - フェーズが変わったら refine(GPT) を背景起動 → refineBlock 更新
       - interviewerTurnNo % 5 == 0 なら evaluate(Opus) を背景起動
```

- **開始**: `start_interview` フレームで面接官の第一声 (`generateInterviewerTurn`) から入る。
- **barge-in**: `barge_in` フレームで `currentAbort.abort()` → Sonnet stream を中断し、新発話を次 turn として処理。
- **音声**: `audio_chunk` を `AsyncQueue` に積み、`runSttPipe` が Iv の STT stream を購読。
  `partial`→`stt_partial`、`final`→`handleUserTurn` に渡す。Iv 未設定なら ack のみ (クライアント側で `stt_final`)。

---

## 4. system prompt の積層 (`buildSystemPrompt`)

応答 Sonnet に渡す `system` は次を上から連結 (空ブロックは除去):

1. **STATIC_ROOT** — 共通ルール (1応答30-200字 / 結論先出し / 質問は1ターン1つ / 人格否定しない / 薄い答えは1段深掘り)
2. **進行フェーズガイダンス** — `PHASE_GUIDANCE[phase]` (opening/probe/pressure/closing)
3. **深掘りの型** — `probe`/`pressure` フェーズのみ弁証法サイクル `DIALECTIC_PROBE` を注入
4. **面接官ペルソナ** — `display_name`/`stage`(人事〜最終)/`role_lens`/`temperament`/`pressure`(1-5)/`tics`/`evaluation_bias`
5. **弱点ブロック** — `weakness_profiles.weak_top3` (今回特に問う軸)
6. **参考素材 (RAG)** — Memoria から引いた本人 ES/portfolio/past_qa excerpt
7. **次に深掘るべき論点** — refine(GPT) or judge の followupHint

会話履歴は `turns` を `interviewer→assistant` / `user→user` にマップして `messages` に渡す。

---

## 5. セッション初期化 (`init`)

1. `sessions` から `metadata.interviewer_id` / `target_company` / `target_role` を読み、`interviewer_personas` を解決。
2. 既存 `session_turns` を復元 (再接続対応)。
3. `weakness_profiles.weak_top3` を読み込み (5 スロット)。
4. **Memoria RAG**: `(target_company + target_role + weak_top3 + stage)` を query に
   `kinds=[es,portfolio,past_qa,self_intro]` / `tags=[stage]` で検索 → `ragBlock`。未設定/失敗は skip。
5. `initialPhaseState(persona.pressure)` でフェーズ機を初期化 → `session_ready` を返す。

---

## 6. セッション跨ぎ学習ループ

Opus 評価 (`evaluate`, 5 turn ごと) の出力を:

- `evaluations` テーブルに保存 (turn_range / axes / comment / hints)。
- `applyEvaluation` で 6 軸を **EMA 集約** (α=0.3) し `weakness_profiles` を更新。

更新された `weak_top3` は **当 session の system prompt には反映せず**、インメモリ表示の更新に留める。
**次 session の (5) 弱点ブロック**に効く (DESIGN §3.2.2)。fine-tune はせず prompt+RAG の重み調整による疑似学習。

---

## 7. 劣化 (graceful degradation)

鍵 / 依存が欠けても面接は進む (best-effort、RULE_CODE §7):

| 欠けるもの | 影響 | 退避 |
|---|---|---|
| `ANTHROPIC_API_KEY` (api backend) | 応答不可 | `llmBackend=cli` なら claude CLI 経由で応答可 |
| 同上 | judge / evaluate skip | フェーズは `DEFAULT_SIGNALS` の time-box 駆動に退化 |
| `OPENAI_API_KEY` | refine skip | refineBlock 無しで継続 |
| `MEMORIA_URL` | RAG skip | ragBlock 無し (ペルソナ + 弱点のみで面接) |
| Iv (音声) | STT 不可 | クライアントが `stt_final` を直接送る |

---

## 8. 非目標 / 関連

- フェーズ遷移規則の詳細・弁証法サイクルの理論: [`dialectic-engine.md`](./dialectic-engine.md)
- モデル割当・collapse プロファイル: [`model-profiles.md`](./model-profiles.md)
- session サマリ (`closing` 到達後の Opus サマリ) / 人間フィードバック loop: DESIGN §3.7-3.8
