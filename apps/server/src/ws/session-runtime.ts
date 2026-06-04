import type { WebSocket } from 'ws';
import {
  buildSystemPrompt,
  createAnthropicClient,
  createOpenAIClient,
  evaluate,
  refine,
  streamResponse,
  streamResponseCli,
  initialPhaseState,
  nextPhase,
  assessAnswer,
  DEFAULT_SIGNALS,
  type PhaseState,
  type PhaseSignals,
  type Turn,
  type InterviewerPersonaInput,
} from '@tirocinium/llm';
import { createMemoriaClient, renderRagBlock, type TrainingDocKind } from '@tirocinium/training';
import { AsyncQueue, createIvClient, type ImperativusClient } from '@tirocinium/voice';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { getInterviewer } from '../persona/repo.js';
import { applyEvaluation } from '../feedback/weakness-updater.js';
import type { ClientFrame, ServerFrame } from './frames.js';

const EVAL_EVERY_N_TURNS = 5;

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
  private llmEnabled: boolean;
  private evalEnabled: boolean;
  private judgeEnabled: boolean;
  private refineEnabled: boolean;
  private ivClient: ImperativusClient | null = null;
  private audioQueue: AsyncQueue<Uint8Array> | null = null;
  private sttPipeRunning = false;

  constructor(
    private readonly ws: WebSocket,
    private readonly sessionId: string,
    private readonly userId: string,
  ) {
    // cli 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨・ API 繧ｭ繝ｼ荳崎ｦ√Ｂpi 繝舌ャ繧ｯ繧ｨ繝ｳ繝峨・ ANTHROPIC_API_KEY 縺瑚ｦ√ｋ縲・
    this.llmEnabled = config.llmBackend === 'cli' || Boolean(process.env['ANTHROPIC_API_KEY']);
    // 隧穂ｾ｡ (Opus) / judge (Haiku) 縺ｯ ANTHROPIC_API_KEY 蜑肴署縲る嵯縺檎┌縺代ｌ縺ｰ髱吶°縺ｫ skip縲・
    this.evalEnabled = Boolean(process.env['ANTHROPIC_API_KEY']);
    this.judgeEnabled = Boolean(process.env['ANTHROPIC_API_KEY']);
    this.refineEnabled = Boolean(process.env['OPENAI_API_KEY']);
    this.ivClient = createIvClient();
  }

  async init(): Promise<void> {
    // session 繝｡繧ｿ + persona id 繧貞叙蠕・
    const sessionRows = await sql<{
      metadata: { interviewer_id?: string };
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

    const interviewerId = sess.metadata?.interviewer_id;
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

    // 譌｢蟄・turn 繧定ｪｭ縺ｿ霎ｼ縺ｿ
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

    // 蠑ｱ轤ｹ繝励Ο繝輔ぃ繧､繝ｫ top3
    const weakRows = await sql<{ weak_top3: string[] }[]>`
      SELECT weak_top3 FROM weakness_profiles WHERE user_id = ${this.userId}
    `;
    this.weakTop3 = weakRows[0]?.weak_top3 ?? [];

    // Memoria RAG fetch (MEMORIA_URL 譛ｪ險ｭ螳壹↑繧・skip)
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
        // Memoria 荳埼＃譎ゅ・ RAG 繝悶Ο繝・け辟｡縺励〒邯咏ｶ壹☆繧・best-effort 邵ｮ騾 (髱｢謗･縺ｯ豁｢繧√↑縺・縲・
        // 譛ｬ莠ｺ迚ｹ蛹悶・蠑ｱ縺ｾ繧九′ session 騾ｲ陦後ｒ蜆ｪ蜈・(RULE_CODE ﾂｧ7)縲・
        console.warn('[ws] memoria rag failed', (err as Error).message);
      }
    }

    // 繝輔ぉ繝ｼ繧ｺ迥ｶ諷区ｩ溘ｒ蛻晄悄蛹・(髱｢謗･螳倥・繝ｫ繧ｽ繝翫・蝨ｧ縺ｧ pressure phase 縺ｮ譛臥┌縺梧ｱｺ縺ｾ繧・
    this.phaseState = initialPhaseState(this.interviewer?.pressure ?? 3);

    this.send({
      kind: 'session_ready',
      session_id: this.sessionId,
      turn_no: this.currentTurnNo,
    });
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
    // 縺薙・蝗樒ｭ斐′蠢懊§縺ｦ縺・ｋ逶ｴ蜑阪・髱｢謗･螳倩ｳｪ蝠・(judge 逕ｨ)縲Ｑush 縺吶ｋ蜑阪↓蜿門ｾ励・
    const lastQuestion = [...this.turns].reverse().find((t) => t.role === 'interviewer')?.text ?? '';

    this.currentTurnNo += 1;
    const userTurnNo = this.currentTurnNo;
    const userTurn: Turn = { turn_no: userTurnNo, role: 'user', text };
    this.turns.push(userTurn);
    await this.persistTurn(userTurnNo, 'user', text);

    this.send({ kind: 'stt_final', text, turn_no: userTurnNo });

    const response = await this.generateInterviewerTurn();
    if (!response) return;
    const { turnNo: interviewerTurnNo, text: acc } = response;

    // 髱槫酔譛・judge: 逶ｴ蜑阪・蜿鈴ｨ楢・屓遲斐ｒ霆ｽ驥上Δ繝・Ν縺ｧ隧穂ｾ｡縺・phase 菫｡蜿ｷ繧呈峩譁ｰ縺吶ｋ縲・
    // 髱｢謗･螳伜ｿ懃ｭ斐・譌｢縺ｫ騾∽ｿ｡貂医∩縺ｪ縺ｮ縺ｧ遏･隕壹Ξ繧､繝・Φ繧ｷ縺ｯ蠅励∴縺ｪ縺・(spec ﾂｧ4.2 (c))縲・
    // 骰ｵ縺檎┌縺・dev 縺ｧ縺ｯ skip 竊・DEFAULT_SIGNALS (time-box 鬧・虚) 縺ｮ縺ｾ縺ｾ縲・
    if (this.judgeEnabled && acc.trim().length > 0) {
      try {
        const signals = await assessAnswer(createAnthropicClient(), {
          question: lastQuestion,
          answer: text,
          recent: this.turns.slice(-4),
        });
        this.latestSignals = {
          synthesisReached: signals.synthesisReached,
          contradictionOpen: signals.contradictionOpen,
        };
        // followup hint 縺後≠繧後・縲梧ｬ｡縺ｫ豺ｱ謗倥ｋ縺ｹ縺崎ｫ也せ縲阪せ繝ｭ繝・ヨ縺ｫ蜿肴丐 (reactive 豺ｱ謗倥ｊ)
        if (signals.followupHint) this.refineBlock = signals.followupHint;
      } catch (err) {
        // judge 螟ｱ謨玲凾縺ｯ latestSignals 繧呈峩譁ｰ縺帙★蜑阪ち繝ｼ繝ｳ縺ｮ菫｡蜿ｷ繧堤ｶｭ謖√☆繧・best-effort 邵ｮ騾縲・
        // phase 驕ｷ遘ｻ縺ｯ time-box (DEFAULT_SIGNALS) 縺ｧ fallback 縺吶ｋ (RULE_CODE ﾂｧ7)縲・
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
    if (!this.llmEnabled) {
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

    const systemPrompt = buildSystemPrompt({
      interviewer: this.interviewer,
      weakTop3: this.weakTop3,
      ragBlock: this.ragBlock || undefined,
      refineBlock: this.refineBlock || undefined,
      phase: this.phaseState?.phase,
    });

    const tokenStream =
      config.llmBackend === 'cli'
        ? streamResponseCli({
            systemPrompt,
            turns: this.turns,
            signal: aborter.signal,
            model: 'sonnet',
          })
        : streamResponse(createAnthropicClient(), {
            systemPrompt,
            turns: this.turns,
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

    const turn: Turn = { turn_no: interviewerTurnNo, role: 'interviewer', text: acc };
    this.turns.push(turn);
    await this.persistTurn(interviewerTurnNo, 'interviewer', acc);
    this.send({
      kind: 'response_end',
      turn_no: interviewerTurnNo,
      text_uri: `local:turn:${interviewerTurnNo}`,
    });
    return { turnNo: interviewerTurnNo, text: acc };
  }

  private async advanceInterviewerPhase(interviewerTurnNo: number): Promise<void> {
    if (this.phaseState) {
      const prevPhase = this.phaseState.phase;
      this.phaseState = nextPhase(this.phaseState, this.latestSignals);
      if (this.refineEnabled && this.phaseState.phase !== prevPhase) {
        void this.runRefineBackground();
      }
    }

    if (this.evalEnabled && interviewerTurnNo > 0 && interviewerTurnNo % EVAL_EVERY_N_TURNS === 0) {
      void this.runEvaluationBackground(interviewerTurnNo);
    }
  }

  private async runRefineBackground(): Promise<void> {
    try {
      const oai = createOpenAIClient();
      const block = await refine(oai, { turns: this.turns });
      if (block) this.refineBlock = block;
    } catch (err) {
      console.error('[ws] refine error', err);
    }
  }

  private handleBargeIn(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
  }

  private handleAudioChunk(pcm: number[]): void {
    // Iv 縺檎┌縺・ｴ蜷・竊・ack 縺ｮ縺ｿ (繧ｯ繝ｩ繧､繧｢繝ｳ繝医・ stt_final 繧貞挨騾秘√ｋ蜑肴署)
    if (!this.ivClient) return;
    // 蛻晏屓 chunk 縺ｧ STT pipe 繧定ｵｷ蜍・
    if (!this.audioQueue) {
      this.audioQueue = new AsyncQueue<Uint8Array>();
      void this.runSttPipe();
    }
    const buf = new Uint8Array(pcm);
    this.audioQueue.push(buf);
  }

  /** Iv 縺ｮ STT stream 繧貞女縺代※ partial/final 繧・WS 縺ｫ豬√☆縲・close 縺輔ｌ繧九∪縺ｧ邯咏ｶ・*/
  private async runSttPipe(): Promise<void> {
    if (!this.ivClient || !this.audioQueue || this.sttPipeRunning) return;
    this.sttPipeRunning = true;
    try {
      for await (const evt of this.ivClient.stt(this.audioQueue)) {
        if (this.closed) break;
        if (evt.kind === 'partial') {
          this.send({ kind: 'stt_partial', text: evt.text });
        } else if (evt.kind === 'final') {
          // final 縺ｯ handleUserTurn 縺ｫ貂｡縺励・Sonnet 蠢懃ｭ斐∪縺ｧ襍ｷ蜍輔☆繧・
          await this.handleUserTurn(evt.text);
        }
      }
    } catch (err) {
      console.warn('[ws] stt pipe error', (err as Error).message);
    } finally {
      this.sttPipeRunning = false;
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
      const client = createAnthropicClient();
      const window = Math.max(0, upToTurnNo - EVAL_EVERY_N_TURNS);
      const slice = this.turns.filter((t) => t.turn_no > window && t.turn_no <= upToTurnNo);
      const ev = await evaluate(client, {
        turns: slice,
        turnRange: [window + 1, upToTurnNo],
      });
      await sql`
        INSERT INTO evaluations (session_id, turn_range, axes, comment, hints, model)
        VALUES (
          ${this.sessionId},
          int4range(${window + 1}, ${upToTurnNo}, '[]'),
          ${sql.json(ev.axes as never)},
          ${ev.comment},
          ${sql.json(ev.hints as never)},
          ${ev.model}
        )
      `;
      this.send({ kind: 'eval', evaluation: ev });

      // 蠑ｱ轤ｹ繝励Ο繝輔ぃ繧､繝ｫ繧・EMA 縺ｧ譖ｴ譁ｰ (task C)
      try {
        const updated = await applyEvaluation(this.userId, ev.axes, ev.hints);
        // 蜷・session 縺ｮ system prompt 縺ｫ縺ｯ蜿肴丐縺励↑縺・(DESIGN ﾂｧ3.2.2)縲・
        // 谺｡蝗・session 縺ｧ (2) 繧ｹ繝ｭ繝・ヨ縺ｫ蜿肴丐縺輔ｌ繧九・蜷・session 蜀・・陦ｨ遉ｺ譖ｴ譁ｰ縺縺・
        this.weakTop3 = updated.weak_top3;
      } catch (err) {
        console.error('[ws] weakness profile update error', err);
      }
    } catch (err) {
      // 隧穂ｾ｡螟ｱ謨励・ session 繧呈ｭ｢繧√↑縺・(繝ｭ繧ｰ縺ｮ縺ｿ)
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
    if (this.audioQueue) {
      this.audioQueue.close();
      this.audioQueue = null;
    }
  }
}
