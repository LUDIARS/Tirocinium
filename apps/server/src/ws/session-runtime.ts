// 面接セッションのランタイム (1 WS = 1 セッション)。
// spec/feature/inference/interviewer-engine.md (turn パイプライン) +
// interviewer-reproduction.md (Brain 境界 / 決定的質問プラン / 面接ブリーフ)。
//
// 責務分担 (spec §2):
//   進行 (フェーズ機 / 質問プラン / turn 予算 / EMA) = 決定的コア (このファイル + packages/llm の純関数)
//   発話・判定・評価 = InterviewerBrain 越しのみ (SDK / CLI / API キーの都合は Brain に閉じる)
//   材料 = 面接ブリーフ (セッション前にコンパイル、セッション中は不変)

import type { WebSocket } from 'ws';
import {
  buildSystemPrompt,
  buildInterviewerPromptBlock,
  createBrain,
  compileQuestionPlan,
  nextSlot,
  mulberry32,
  newSessionSeed,
  initialPhaseState,
  nextPhase,
  AXIS_KEYS,
  DEFAULT_SIGNALS,
  type AxisKey,
  type InterviewerBrain,
  type PhaseState,
  type PhaseSignals,
  type QuestionSlot,
  type Turn,
  type InterviewerPersonaInput,
} from '@tirocinium/llm';
import { createMemoriaClient, renderRagBlock, type TrainingDocKind } from '@tirocinium/training';
import { AsyncQueue, createIvClient, type AudioFormat, type ImperativusClient } from '@tirocinium/voice';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { getInterviewer } from '../persona/repo.js';
import { applyEvaluation } from '../feedback/weakness-updater.js';
import { buildInterviewBrief, planBriefFromSourceMeta } from '../brief/brief-builder.js';
import { getBrief, saveBriefIfAbsent } from '../brief/repo.js';
import type { ClientFrame, ServerFrame } from './frames.js';

const EVAL_EVERY_N_TURNS = 5;

/** WS 向け TTS の PCM フォーマット (VOICEVOX ネイティブ 24kHz mono、リサンプル不要)。 */
const WS_TTS_FORMAT: AudioFormat = {
  sampleRate: 24000,
  channels: 1,
  bitDepth: 16,
  encoding: 'pcm-s16le',
};

export type SessionRuntimeOptions = {
  /** LLM 境界。省略時は env TIROCINIUM_BRAIN に従い生成 (llm | stub)。 */
  brain?: InterviewerBrain;
  /** TTS を WS の tts_chunk で流すか。Discord bridge は自前で再生するため false を渡す。 */
  ttsOverWs?: boolean;
};

/** JSONB (PG) / TEXT (SQLite) 両対応の object 読出し。 */
function asObject(v: unknown): Record<string, unknown> {
  const obj = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  return obj && typeof obj === 'object' && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)
    : {};
}

/** 句点区切りの文分割 (TTS の先頭レイテンシ削減。voicevox-tts.md §5)。 */
function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [text.trim()];
}

export class SessionRuntime {
  private turns: Turn[] = [];
  private currentTurnNo = 0;
  private currentAbort: AbortController | null = null;
  private interviewer: InterviewerPersonaInput | null = null;
  private weakTop3: string[] = [];
  private ragBlock = '';
  private refineBlock = '';
  private phaseState: PhaseState | null = null;
  private latestSignals: PhaseSignals = DEFAULT_SIGNALS;
  private closed = false;
  private readonly brain: InterviewerBrain;
  private readonly ttsOverWs: boolean;
  /** 決定的質問プラン (P2)。flag off / ブリーフ未構築時は null (従来のプロンプト駆動)。 */
  private readonly planEnabled: boolean;
  private plan: QuestionSlot[] | null = null;
  /** phase → 消化済みスロット数 */
  private planCursor: Record<string, number> = {};
  private briefMd = '';
  private ivClient: ImperativusClient | null = null;
  private audioQueue: AsyncQueue<Uint8Array> | null = null;
  private sttPipeRunning = false;
  private ttsAbort: AbortController | null = null;

  constructor(
    private readonly ws: WebSocket,
    private readonly sessionId: string,
    private readonly userId: string,
    opts: SessionRuntimeOptions = {},
  ) {
    // LLM の有効/無効 (cli バックエンドは API キー不要、api は ANTHROPIC_API_KEY 前提、
    // refine は OPENAI_API_KEY 前提) は Brain の can* に閉じている。
    this.brain = opts.brain ?? createBrain({ llmBackend: config.llmBackend });
    this.ttsOverWs = opts.ttsOverWs ?? true;
    this.planEnabled = process.env['TIROCINIUM_QUESTION_PLAN'] === '1';
    this.ivClient = createIvClient();
  }

  async init(): Promise<void> {
    // session メタ + persona id を取得
    const sessionRows = await sql<{
      metadata: unknown;
      llm_profile: Record<string, unknown>;
      target_company: string | null;
      target_role: string | null;
    }[]>`
      SELECT metadata, llm_profile, target_company, target_role
      FROM sessions WHERE id = ${this.sessionId}
    `;
    const sess = sessionRows[0];
    if (!sess) {
      this.send({ kind: 'system', code: 'error', message: 'session not found' });
      this.ws.close();
      return;
    }
    const metadata = asObject(sess.metadata);

    const interviewerId = typeof metadata['interviewer_id'] === 'string' ? metadata['interviewer_id'] : undefined;
    if (interviewerId) {
      const p = await getInterviewer(interviewerId);
      if (p) {
        this.interviewer = {
          display_name: p.display_name,
          stage: p.stage,
          role_lens: p.role_lens,
          temperament: p.temperament,
          pressure: p.pressure,
          tics: p.tics,
          bio: p.bio,
          evaluation_bias: p.evaluation_bias,
        };
      }
    }

    // 既存 turn を読み込み (再接続復元)
    const turnRows = await sql<{ turn_no: number; role: 'interviewer' | 'user'; stt_text: string | null; text_uri: string }[]>`
      SELECT turn_no, role, stt_text, text_uri FROM session_turns
      WHERE session_id = ${this.sessionId} ORDER BY turn_no ASC
    `;
    this.turns = turnRows.map((r) => ({
      turn_no: r.turn_no,
      role: r.role,
      text: r.stt_text ?? r.text_uri,
    }));
    this.currentTurnNo = this.turns.length;

    // 弱点プロファイル top3
    const weakRows = await sql<{ weak_top3: string[] }[]>`
      SELECT weak_top3 FROM weakness_profiles WHERE user_id = ${this.userId}
    `;
    this.weakTop3 = weakRows[0]?.weak_top3 ?? [];

    // Memoria RAG fetch (MEMORIA_URL 未設定なら skip)
    const memoria = createMemoriaClient();
    if (memoria) {
      try {
        const queryParts = [
          sess.target_company,
          sess.target_role,
          ...this.weakTop3,
          this.interviewer?.stage,
        ].filter(Boolean);
        const query = queryParts.join(' ') || 'interview practice';
        const filterTags = this.interviewer?.stage ? [this.interviewer.stage] : undefined;
        const filterKinds: TrainingDocKind[] = ['es', 'portfolio', 'past_qa', 'self_intro'];
        const result = await memoria.rag({
          user_id: this.userId,
          query,
          filter: { kinds: filterKinds, tags: filterTags },
          topK: 6,
        });
        this.ragBlock = renderRagBlock(result);
      } catch (err) {
        // Memoria 不達時は RAG ブロック無しで継続する (面接進行を優先。
        // 本人特化は弱まるが session は止めない — RULE_CODE §7 の縮退)。
        console.warn('[ws] memoria rag failed', (err as Error).message);
      }
    }

    // フェーズ状態機を初期化 (面接官ペルソナの圧で pressure phase の有無が決まる)
    this.phaseState = initialPhaseState(this.interviewer?.pressure ?? 3);

    // 決定的質問プラン (P2、TIROCINIUM_QUESTION_PLAN=1 のときのみ)。
    // ブリーフはセッション前 (init) にコンパイルし、以降は不変 (spec §5)。
    if (this.planEnabled && this.interviewer) {
      try {
        await this.compilePlan(metadata, sess.target_company, sess.target_role);
      } catch (err) {
        // プラン構築失敗はプロンプト駆動へ「明示的に」縮退する (ログ + system frame)。
        console.error('[ws] question plan compile failed', err);
        this.send({
          kind: 'system',
          code: 'error',
          message: `question plan unavailable: ${(err as Error).message}`,
        });
      }
    }

    this.send({
      kind: 'session_ready',
      session_id: this.sessionId,
      turn_no: this.currentTurnNo,
    });
  }

  /** session_seed を確定し (無ければ採番して永続化)、ブリーフを構築/復元してプランを組む。 */
  private async compilePlan(
    metadata: Record<string, unknown>,
    targetCompany: string | null,
    targetRole: string | null,
  ): Promise<void> {
    if (!this.interviewer) return;

    // seed: metadata に無い旧セッションはここで採番して永続化 (再接続で不変)
    let seed: number;
    const rawSeed = Number(metadata['session_seed']);
    if (Number.isFinite(rawSeed) && rawSeed > 0) {
      seed = rawSeed >>> 0;
    } else {
      seed = newSessionSeed();
      await sql`
        UPDATE sessions SET metadata = ${sql.json({ ...metadata, session_seed: seed } as never)}
        WHERE id = ${this.sessionId}
      `;
    }

    // ブリーフ: 既存 (再接続) があればそれを使い、無ければコンパイルして保存
    let stored = await getBrief(this.sessionId);
    if (!stored) {
      const built = await buildInterviewBrief({
        stage: this.interviewer.stage,
        targetCompany,
        targetRole,
        personaBlock: buildInterviewerPromptBlock(this.interviewer),
        weakTop3: this.weakTop3,
        ragBlock: this.ragBlock,
        seed,
      });
      stored = await saveBriefIfAbsent(this.sessionId, built.bodyMd, built.sourceMeta, seed);
    }
    this.briefMd = stored.body_md;

    const planBrief = planBriefFromSourceMeta(stored.source_meta);
    if (!planBrief) {
      throw new Error('stored brief に候補 snapshot が無い (source_meta.candidates)');
    }
    const weakAxes = this.weakTop3.filter((a): a is AxisKey => (AXIS_KEYS as string[]).includes(a));
    this.plan = compileQuestionPlan(planBrief, weakAxes, mulberry32(stored.seed));

    // 再接続時: 既に消化した interviewer turn 数ぶんカーソルを進める…は phase 履歴が
    // 要るため、簡便に「現 phase の消化数 = 0」から再開する (プラン自体は同一)。
  }

  async onMessage(raw: string): Promise<void> {
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw) as ClientFrame;
    } catch {
      this.send({ kind: 'system', code: 'error', message: 'invalid json' });
      return;
    }

    switch (frame.kind) {
      case 'start_interview':
        await this.handleStartInterview();
        break;
      case 'stt_final':
        await this.handleUserTurn(frame.text);
        break;
      case 'barge_in':
        this.handleBargeIn();
        break;
      case 'end_session':
        await this.handleEnd();
        break;
      case 'audio_chunk':
        this.handleAudioChunk(frame.pcm);
        break;
      case 'pong':
        // keepalive
        break;
      default:
        this.send({ kind: 'system', code: 'error', message: `unknown frame kind` });
    }
  }

  private async handleUserTurn(text: string): Promise<void> {
    // この回答が応じている直前の面接官質問 (judge 用)。push する前に取得。
    const lastQuestion = [...this.turns].reverse().find((t) => t.role === 'interviewer')?.text ?? '';

    this.currentTurnNo += 1;
    const userTurnNo = this.currentTurnNo;
    const userTurn: Turn = { turn_no: userTurnNo, role: 'user', text };
    this.turns.push(userTurn);
    await this.persistTurn(userTurnNo, 'user', text);

    this.send({ kind: 'stt_final', text, turn_no: userTurnNo });

    const response = await this.generateInterviewerTurn();
    if (!response) return;
    const { turnNo: interviewerTurnNo } = response;

    // 非同期 judge: 直前の受験者回答を軽量モデルで評価し phase 信号を更新する。
    // 面接官応答は既に送信済みなので知覚レイテンシは増えない (engine spec §4.2 (c))。
    // 鍵が無い dev では Brain が can 判定で skip → DEFAULT_SIGNALS (time-box 駆動) のまま。
    if (this.brain.canAssess() && response.text.trim().length > 0) {
      try {
        const signals = await this.brain.assessAnswer({
          question: lastQuestion,
          answer: text,
          recent: this.turns.slice(-4),
        });
        this.latestSignals = {
          synthesisReached: signals.synthesisReached,
          contradictionOpen: signals.contradictionOpen,
        };
        // followup hint があれば「次に深掘るべき論点」スロットに反映 (reactive 深掘り)
        if (signals.followupHint) this.refineBlock = signals.followupHint;
      } catch (err) {
        // judge 失敗時は latestSignals を更新せず前ターンの信号を維持する縮退。
        // phase 遷移は time-box (DEFAULT_SIGNALS) で fallback する (RULE_CODE §7)。
        console.warn('[ws] judge failed', (err as Error).message);
      }
    }

    await this.advanceInterviewerPhase(interviewerTurnNo);
  }

  private async handleStartInterview(): Promise<void> {
    const response = await this.generateInterviewerTurn();
    if (!response) return;
    await this.advanceInterviewerPhase(response.turnNo);
  }

  private async generateInterviewerTurn(): Promise<{ turnNo: number; text: string } | null> {
    if (!this.brain.canCompose()) {
      this.send({ kind: 'system', code: 'error', message: 'llm not configured' });
      return null;
    }
    if (!this.interviewer) {
      this.send({ kind: 'system', code: 'error', message: 'interviewer persona missing' });
      return null;
    }

    this.currentTurnNo += 1;
    const interviewerTurnNo = this.currentTurnNo;
    const aborter = new AbortController();
    this.currentAbort = aborter;

    // プラン駆動: 現 phase の未消化スロットを取り、Brain が persona 口調へ整形する
    const slot =
      this.plan && this.phaseState
        ? nextSlot(this.plan, this.phaseState.phase, this.planCursor)
        : null;

    const systemPrompt = buildSystemPrompt({
      interviewer: this.interviewer,
      weakTop3: this.weakTop3,
      ragBlock: this.ragBlock || undefined,
      refineBlock: this.refineBlock || undefined,
      phase: this.phaseState?.phase,
      briefMd: this.briefMd || undefined,
    });

    const tokenStream = this.brain.composeUtterance({
      systemPrompt,
      turns: this.turns,
      slot,
      signal: aborter.signal,
    });

    let acc = '';
    try {
      for await (const token of tokenStream) {
        acc += token;
        this.send({ kind: 'response_token', token, turn_no: interviewerTurnNo });
        if (this.closed) {
          aborter.abort();
          break;
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        this.send({
          kind: 'system',
          code: 'error',
          message: err instanceof Error ? err.message : 'stream error',
        });
      }
    } finally {
      this.currentAbort = null;
    }

    if (acc.trim().length === 0) {
      this.currentTurnNo -= 1;
      return null;
    }

    // スロットを消化 (発話が成立した時だけ進める)
    if (slot && this.phaseState) {
      const phase = this.phaseState.phase;
      this.planCursor[phase] = (this.planCursor[phase] ?? 0) + 1;
    }

    const turn: Turn = { turn_no: interviewerTurnNo, role: 'interviewer', text: acc };
    this.turns.push(turn);
    await this.persistTurn(interviewerTurnNo, 'interviewer', acc);
    this.send({
      kind: 'response_end',
      turn_no: interviewerTurnNo,
      text_uri: `local:turn:${interviewerTurnNo}`,
    });

    // TTS は付加経路 — 背景で流し、失敗しても面接 (テキスト) は止めない
    void this.runTtsBackground(interviewerTurnNo, acc);

    return { turnNo: interviewerTurnNo, text: acc };
  }

  private async advanceInterviewerPhase(interviewerTurnNo: number): Promise<void> {
    if (this.phaseState) {
      const prevPhase = this.phaseState.phase;
      this.phaseState = nextPhase(this.phaseState, this.latestSignals);
      if (this.brain.canRefine() && this.phaseState.phase !== prevPhase) {
        void this.runRefineBackground();
      }
    }

    if (this.brain.canEvaluate() && interviewerTurnNo > 0 && interviewerTurnNo % EVAL_EVERY_N_TURNS === 0) {
      void this.runEvaluationBackground(interviewerTurnNo);
    }
  }

  private async runRefineBackground(): Promise<void> {
    try {
      const focus = await this.brain.refineFocus({ turns: this.turns });
      if (!focus) return;
      if (this.plan && this.phaseState && this.phaseState.phase !== 'ended') {
        // プラン駆動: 逸脱も origin 付きでプランに追記して記録する (spec §4)。
        // refineBlock には入れない (スロット経由で発話されるため二重注入を避ける)。
        this.insertDeviationSlot(focus);
      } else {
        this.refineBlock = focus;
      }
    } catch (err) {
      console.error('[ws] refine error', err);
    }
  }

  /** refineFocus の逸脱スロットを現 phase の次消化位置に追記する。 */
  private insertDeviationSlot(focus: string): void {
    if (!this.plan || !this.phaseState) return;
    const phase = this.phaseState.phase;
    if (phase === 'ended') return;
    const slot: QuestionSlot = {
      theme: '深掘り論点 (逸脱)',
      question: focus,
      followups: [],
      axes: [],
      origin: 'refine',
      phase,
    };
    // 現 phase の「次に消化されるスロット」の直前 (グローバル index) に挿入する
    const consumed = this.planCursor[phase] ?? 0;
    let seen = 0;
    let insertAt = this.plan.length;
    for (let i = 0; i < this.plan.length; i++) {
      if (this.plan[i]!.phase !== phase) continue;
      if (seen === consumed) {
        insertAt = i;
        break;
      }
      seen += 1;
    }
    this.plan.splice(insertAt, 0, slot);
  }

  private handleBargeIn(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    if (this.ttsAbort) {
      this.ttsAbort.abort();
    }
  }

  private handleAudioChunk(pcm: number[]): void {
    // Iv が無い場合 → ack のみ (クライアントは stt_final を別送する前提)
    if (!this.ivClient) return;
    // 初回 chunk で STT pipe を起動
    if (!this.audioQueue) {
      this.audioQueue = new AsyncQueue<Uint8Array>();
      void this.runSttPipe();
    }
    const buf = new Uint8Array(pcm);
    this.audioQueue.push(buf);
  }

  /** Iv の STT stream を受けて partial/final を WS に流す。close されるまで継続 */
  private async runSttPipe(): Promise<void> {
    if (!this.ivClient || !this.audioQueue || this.sttPipeRunning) return;
    this.sttPipeRunning = true;
    try {
      for await (const evt of this.ivClient.stt(this.audioQueue)) {
        if (this.closed) break;
        if (evt.kind === 'partial') {
          this.send({ kind: 'stt_partial', text: evt.text });
        } else if (evt.kind === 'final') {
          // final は handleUserTurn に渡し、面接官応答まで起動する
          await this.handleUserTurn(evt.text);
        }
      }
    } catch (err) {
      console.warn('[ws] stt pipe error', (err as Error).message);
    } finally {
      this.sttPipeRunning = false;
    }
  }

  /** 面接官発話を文単位で TTS し tts_chunk / tts_end を送る (voicevox-tts.md §5/§6)。
   *  失敗は明示エラー (system frame + ログ) — 無音のまま成功を装わない。 */
  private async runTtsBackground(turnNo: number, text: string): Promise<void> {
    if (!this.ttsOverWs || !this.ivClient?.hasTts()) return;
    // 直前 turn の合成が残っていれば破棄 (最新発話を優先)
    if (this.ttsAbort) this.ttsAbort.abort();
    const aborter = new AbortController();
    this.ttsAbort = aborter;
    try {
      for (const sentence of splitSentences(text)) {
        if (aborter.signal.aborted || this.closed) return;
        for await (const chunk of this.ivClient.tts(
          { text: sentence, format: WS_TTS_FORMAT },
          aborter.signal,
        )) {
          if (aborter.signal.aborted || this.closed) return;
          this.send({
            kind: 'tts_chunk',
            turn_no: turnNo,
            pcm: Array.from(chunk),
            sample_rate: WS_TTS_FORMAT.sampleRate,
            channels: WS_TTS_FORMAT.channels,
          });
        }
      }
      if (!aborter.signal.aborted) {
        this.send({ kind: 'tts_end', turn_no: turnNo });
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      console.warn('[ws] tts failed', (err as Error).message);
      this.send({
        kind: 'system',
        code: 'error',
        message: `tts failed: ${(err as Error).message}`,
      });
    } finally {
      if (this.ttsAbort === aborter) this.ttsAbort = null;
    }
  }

  private async handleEnd(): Promise<void> {
    this.closed = true;
    await sql`
      UPDATE sessions SET status = 'ended', ended_at = now()
      WHERE id = ${this.sessionId} AND status = 'active'
    `;
    this.send({ kind: 'system', code: 'closing' });
    this.ws.close();
  }

  private async runEvaluationBackground(upToTurnNo: number): Promise<void> {
    try {
      const window = Math.max(0, upToTurnNo - EVAL_EVERY_N_TURNS);
      const slice = this.turns.filter((t) => t.turn_no > window && t.turn_no <= upToTurnNo);
      const ev = await this.brain.evaluate({
        turns: slice,
        turnRange: [window + 1, upToTurnNo],
      });
      await sql`
        INSERT INTO evaluations (session_id, turn_range, axes, comment, hints, model, method)
        VALUES (
          ${this.sessionId},
          ${`[${window + 1},${upToTurnNo}]`},
          ${sql.json(ev.axes as never)},
          ${ev.comment},
          ${sql.json(ev.hints as never)},
          ${ev.model},
          ${this.brain.kind}
        )
      `;
      this.send({ kind: 'eval', evaluation: ev });

      // 弱点プロファイルを EMA で更新
      try {
        const updated = await applyEvaluation(this.userId, ev.axes, ev.hints);
        // 同 session の system prompt には反映しない (DESIGN §3.2.2)。
        // 次回 session でスロット選択に反映される。同 session 内は表示更新だけ。
        this.weakTop3 = updated.weak_top3;
      } catch (err) {
        console.error('[ws] weakness profile update error', err);
      }
    } catch (err) {
      // 評価失敗は session を止めない (ログのみ)
      console.error('[ws] evaluation error', err);
    }
  }

  private async persistTurn(turnNo: number, role: 'interviewer' | 'user', text: string): Promise<void> {
    await sql`
      INSERT INTO session_turns (session_id, turn_no, role, stt_text, text_uri, started_at)
      VALUES (
        ${this.sessionId}, ${turnNo}, ${role},
        ${role === 'user' ? text : null},
        ${'local:turn:' + turnNo},
        now()
      )
      ON CONFLICT (session_id, turn_no) DO NOTHING
    `;
  }

  private send(frame: ServerFrame): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(JSON.stringify(frame));
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.currentAbort) this.currentAbort.abort();
    if (this.ttsAbort) this.ttsAbort.abort();
    if (this.audioQueue) {
      this.audioQueue.close();
      this.audioQueue = null;
    }
  }
}
