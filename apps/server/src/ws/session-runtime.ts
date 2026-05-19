import type { WebSocket } from 'ws';
import {
  buildSystemPrompt,
  createAnthropicClient,
  evaluate,
  streamResponse,
  type Turn,
  type InterviewerPersonaInput,
} from '@tirocinium/llm';
import { sql } from '../db/index.js';
import { getInterviewer } from '../persona/repo.js';
import type { ClientFrame, ServerFrame } from './frames.js';

const EVAL_EVERY_N_TURNS = 5;

export class SessionRuntime {
  private turns: Turn[] = [];
  private currentTurnNo = 0;
  private currentAbort: AbortController | null = null;
  private interviewer: InterviewerPersonaInput | null = null;
  private weakTop3: string[] = [];
  private closed = false;
  private llmEnabled: boolean;

  constructor(
    private readonly ws: WebSocket,
    private readonly sessionId: string,
    private readonly userId: string,
  ) {
    this.llmEnabled = Boolean(process.env['ANTHROPIC_API_KEY']);
  }

  async init(): Promise<void> {
    // session メタ + persona id を取得
    const sessionRows = await sql<{
      metadata: { interviewer_id?: string };
      llm_profile: Record<string, unknown>;
    }[]>`
      SELECT metadata, llm_profile FROM sessions WHERE id = ${this.sessionId}
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

    // 既存 turn を読み込み
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
        // STT 経路は Iv 連携 PR (E) で実装。 今は ack のみ。
        break;
      case 'pong':
        // keepalive
        break;
      default:
        this.send({ kind: 'system', code: 'error', message: `unknown frame kind` });
    }
  }

  private async handleUserTurn(text: string): Promise<void> {
    this.currentTurnNo += 1;
    const userTurnNo = this.currentTurnNo;
    const userTurn: Turn = { turn_no: userTurnNo, role: 'user', text };
    this.turns.push(userTurn);
    await this.persistTurn(userTurnNo, 'user', text);

    this.send({ kind: 'stt_final', text, turn_no: userTurnNo });

    // Sonnet stream → interviewer 応答
    if (!this.llmEnabled) {
      this.send({ kind: 'system', code: 'error', message: 'llm not configured' });
      return;
    }
    if (!this.interviewer) {
      this.send({ kind: 'system', code: 'error', message: 'interviewer persona missing' });
      return;
    }

    this.currentTurnNo += 1;
    const interviewerTurnNo = this.currentTurnNo;
    const aborter = new AbortController();
    this.currentAbort = aborter;

    const client = createAnthropicClient();
    const systemPrompt = buildSystemPrompt({
      interviewer: this.interviewer,
      weakTop3: this.weakTop3,
    });

    let acc = '';
    try {
      for await (const token of streamResponse(client, {
        systemPrompt,
        turns: this.turns,
        signal: aborter.signal,
      })) {
        acc += token;
        this.send({ kind: 'response_token', token, turn_no: interviewerTurnNo });
        if (this.closed) {
          aborter.abort();
          break;
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        // barge-in による中断、 既に蓄積 acc を確定保存
      } else {
        this.send({
          kind: 'system',
          code: 'error',
          message: err instanceof Error ? err.message : 'stream error',
        });
      }
    } finally {
      this.currentAbort = null;
    }

    if (acc.trim().length > 0) {
      const turn: Turn = { turn_no: interviewerTurnNo, role: 'interviewer', text: acc };
      this.turns.push(turn);
      await this.persistTurn(interviewerTurnNo, 'interviewer', acc);
      this.send({
        kind: 'response_end',
        turn_no: interviewerTurnNo,
        text_uri: `local:turn:${interviewerTurnNo}`,
      });
    } else {
      // 何も生成できなかった (barge-in 即時 abort 等) → ロールバック
      this.currentTurnNo -= 1;
    }

    // 5 turn ごとに Opus 評価 (バックグラウンド)
    if (interviewerTurnNo > 0 && interviewerTurnNo % EVAL_EVERY_N_TURNS === 0) {
      void this.runEvaluationBackground(interviewerTurnNo);
    }
  }

  private handleBargeIn(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
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
  }
}
