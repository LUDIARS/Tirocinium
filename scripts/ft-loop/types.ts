export type FtLoopArgs = {
  interviewer: string;
  examinee: string;
  turns: number;
  output: string;
  dryRun: boolean;
};

export type Turn = {
  turn_no: number;
  role: 'interviewer' | 'user';
  text: string;
  ts: string;
};

export type EvaluationRecord = {
  turn_range: [number, number];
  scored_at: string;
  axes: Record<string, number>;
  comment: string;
  hints: string[];
  model: string;
};

export type SummaryDoc = {
  headline: string;
  highlights: { turn_no: number; comment: string }[];
  axes_summary: {
    final: Record<string, number>;
    ema_delta: Record<string, number>;
  };
  growth_points: string[];
  carry_over: string[];
  interviewer_note: string;
};

export type AiCritiqueDoc = {
  per_turn: {
    turn_no: number;
    examinee_answer: string;
    better_answer: string;
    axes_lifted: string[];
    rationale: string;
  }[];
};

export type FeedbackAction = 'accept' | 'reject' | 'edit' | 'skip';

export type HumanFeedbackDoc = {
  session_id: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  summary_blocks: Record<string, { action: FeedbackAction; per_item?: unknown[]; edit_payload?: unknown }>;
  ai_critique: { action: FeedbackAction; per_turn: { turn_no: number; action: FeedbackAction; note?: string }[] };
  notes: string;
};

export type RunMeta = {
  interviewer_id: string;
  examinee_id: string;
  turns_requested: number;
  turns_completed: number;
  models: {
    interviewer: string;
    examinee: string;
    evaluator: string;
    summarizer: string;
    critic: string;
  };
  started_at: string;
  ended_at: string | null;
  status: 'running' | 'completed' | 'aborted';
};
