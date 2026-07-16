# 面接エンジン実装タスク分解 — 面接官再現 P1+P2 + VOICEVOX TTS

[`spec/feature/inference/interviewer-reproduction.md`](../feature/inference/interviewer-reproduction.md)
の P1 / P2 と、VOICEVOX による TTS 結線
([`spec/feature/voice/voicevox-tts.md`](../feature/voice/voicevox-tts.md)) を
1 PR で実装するためのタスク分解 (着手前 task md、AIFormat HARNESS §3.1 フルセット原則)。

- **設計判断の正本**: interviewer-reproduction.md (P1/P2)、voicevox-tts.md (音声)。
  本ファイルは分解と進捗の記録のみ。
- **応用元**: Discutere の議論エンジン — discussion_paper (md 正本 + system 安定部キャッシュ)
  → 面接ブリーフ、information-gate → 充足ゲート、game-aliases の教訓 → role-aliases。
  Pagus — Brain DI / 注入 rng / coerce 検証 / stub 一巡テスト。
- **スコープ外 (フォローアップ)**: P3 (OB コーパス抽出バッチ / judge blackbox 卒業 /
  リプレイ CLI / LLM 充足ゲート)、Imperativus 本体の TTS 経路実装、
  デスクトップの音声デバイス選択 UI。

## T1 決定性基盤 (packages/llm)

- [x] T1.1 `src/rng.ts` — mulberry32 (seed 注入 PRNG、依存追加なし) + `newSessionSeed()`
- [x] T1.2 `src/coerce.ts` — `coerceSignals` / `coerceAxes` / `coerceFocus`。
      原則: clamp できるものは clamp、構造違反は throw (spec §3)

## T2 Brain 境界 (packages/llm) — P1

- [x] T2.1 `src/brain.ts` — `InterviewerBrain` interface
      (composeUtterance / assessAnswer / refineFocus / evaluate。spec §3 の型)
- [x] T2.2 `LlmBrain` — 既存 response(stream)/judge/refine/evaluator を内側に移設。
      api/cli 切替 (`config.llmBackend`) は Brain 内に閉じる。鍵の有無による
      機能単位の有効/無効も Brain が判断し、呼び出し側へ露出しない
- [x] T2.3 `StubBrain` — 決定的テンプレート。スロットの question をそのまま発話、
      signal はカウンタ規則 (probe minTurns 消化で synthesis) で返す
- [x] T2.4 `createBrain(env)` — `TIROCINIUM_BRAIN=llm|stub` (既定 llm)。不正値は即 throw
- [x] T2.5 judge/evaluator の parse を coerce 経由に。parse 失敗は 1 回だけ再呼び出し、
      それでも失敗なら `DEFAULT_SIGNALS` へ劣化 (engine spec §7 の劣化表)

## T3 決定的質問プラン (packages/llm) — P2

- [x] T3.1 `src/question-plan.ts` — `QuestionSlot` / `InterviewBrief` 型 +
      `compileQuestionPlan(brief, weakTop3, rng)` 純関数。
      供給源優先順 company > ob > newgrad > seed、弱点駆動重み、
      PHASE_SPECS に沿う phase 割付、同点シャッフルは注入 rng のみ
- [x] T3.2 `src/role-aliases.ts` — 職種/技術別名の静的辞書 + `expandTerms()` +
      keyword 素朴分解 (句読点/空白 split、依存ゼロ)

## T4 面接ブリーフ + 充足ゲート (apps/server) — P2

- [x] T4.1 migration `024_interview_engine.sql` — `interview_briefs` /
      `company_interview_questions` (spec 前提だが未作成だったテーブル) /
      `ob_question_patterns` (器のみ、抽出バッチは P3) /
      `evaluations.method` 列追加。冪等 (IF NOT EXISTS)、SQLite/PG 両対応
- [x] T4.2 `src/brief/qa-seed-loader.ts` — `data/general/qa-seed/<stage>/<role>.json` 読込。
      role ファイル欠損時は同 stage の存在ファイルへ明示退避 (無言 fallback 禁止)
- [x] T4.3 `src/brief/sources.ts` — target_company 名→companies 解決 (別名込み)、
      newgrad_role_images / company_interview_questions / ob_question_patterns 取得
- [x] T4.4 `src/brief/sufficiency-gate.ts` — 決定的カウントで rich/moderate/sparse 判定。
      sparse は qa-seed 退避をブリーフ本文 + source_meta に明記
- [x] T4.5 `src/brief/brief-builder.ts` — md ブリーフ組立 (見出し固定: 企業と職種 /
      求める新卒像 / 過去の質問傾向 / 受験者の素材 / 面接官ペルソナ / 今回の重点)
- [x] T4.6 `src/brief/repo.ts` — interview_briefs の保存/取得 (session_id UNIQUE)
- [x] T4.7 セッション作成時に `session_seed` 採番 → `sessions.metadata` へ永続化
      (`reservation/coordinator.ts` の INSERT)

## T5 SessionRuntime 統合 (apps/server)

- [x] T5.1 Brain をコンストラクタ注入。直 SDK/CLI 呼び出しを撤去
      (併せて既存の文字化けコメントを正常な日本語に復元)
- [x] T5.2 init でブリーフ構築 or 復元 + seed 復元 + プランコンパイル。
      プラン駆動は feature flag `TIROCINIUM_QUESTION_PLAN=1` (既定 off、
      既存プロンプト駆動と並走 → sim-batch 比較後に既定化。spec §8)
- [x] T5.3 プラン駆動発話 — 現 phase の未消化スロット → `composeUtterance`。
      judge の followupHint はスロット内 followup 選択に使い、refineFocus の
      逸脱採用は `origin` 付きでプランへ追記 (逸脱も記録)
- [x] T5.4 evaluations INSERT に `method` (llm/stub) を記録
- [x] T5.5 system prompt の素材系 (新卒像/質問傾向/RAG) をブリーフから読む形へ寄せ、
      不変部を最大化 (揮発は refineBlock + 会話履歴のみ)

## T6 VOICEVOX TTS (packages/voice + 配線)

- [x] T6.1 `src/tts-provider.ts` — `TtsProvider` interface (SttProvider と対称) +
      `createTtsProvider(env)`。`TIROCINIUM_TTS_BACKEND=voicevox|off` (既定 off)。
      不正値は即 throw (無言フォールバック禁止)
- [x] T6.2 `src/tts-voicevox-provider.ts` — VOICEVOX engine client
      (`/audio_query` → `/synthesis`、WAV ヘッダ除去 → PCM s16le chunk)。
      `TtsRequest.format` を audio_query の outputSamplingRate / outputStereo に反映。
      env: `TIROCINIUM_VOICEVOX_URL` (既定 `http://127.0.0.1:50021`) /
      `TIROCINIUM_VOICEVOX_SPEAKER` (既定 13)
- [x] T6.3 `iv-client.ts` — cfg に `ttsProvider` を追加し `tts()` が委譲
      (Iv 本体経路の TODO は維持)。`createIvClient` に配線
- [x] T6.4 WS 出力 — `ServerFrame` に `tts_chunk` / `tts_end` を追加。
      session-runtime が response_end 後に合成して送出。barge-in で abort
- [x] T6.5 Discord voice-bridge — `playTts` が 48kHz stereo を `TtsRequest.format` で要求
- [x] T6.6 desktop — `src/audio/speaker-playback.ts` (WebAudio で PCM 再生) +
      SessionWebSocket / SessionLive への配線

## T7 テスト (vitest)

- [x] T7.1 rng (同 seed 同列) / coerce (clamp・throw 境界) / role-aliases
- [x] T7.2 question-plan — 同 seed+ブリーフ → 同一プラン exact / 弱点優先 / phase 割付数
- [x] T7.3 golden transcript — StubBrain + 固定 seed + 固定ブリーフで
      プラン・フェーズ遷移・発話列を exact assert (Pagus 一巡テスト方式)
- [x] T7.4 sufficiency-gate / brief-builder (md golden) / qa-seed-loader (欠損退避)
- [x] T7.5 tts-voicevox-provider — fetch mock で query→synthesis、WAV 除去、format 反映

## T8 spec / ドキュメント

- [x] T8.1 `spec/feature/voice/voicevox-tts.md` 新規 (設計判断の正本)
- [x] T8.2 interviewer-reproduction.md に実装状況追記 /
      `spec/data/README.md` に migration 024 / voice README の TTS 節更新
- [x] T8.3 新 env (`TIROCINIUM_BRAIN` / `TIROCINIUM_QUESTION_PLAN` /
      `TIROCINIUM_TTS_BACKEND` / `TIROCINIUM_VOICEVOX_*`) を設定ドキュメントへ反映

## 完了条件 (DoD)

- 全 workspace build + vitest green (CI 相当をローカルで裏取り)
- StubBrain + 固定 seed の golden transcript が決定的に再生される
- `TIROCINIUM_TTS_BACKEND=voicevox` + VOICEVOX engine 起動時に
  面接官発話が PCM で WS / Discord へ流れる (エンジン不在時は起動時に明示エラー)
- PR 作成 (マージは指示待ち — Tr は自動マージしない)
