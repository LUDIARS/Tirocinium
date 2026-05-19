// 共通型 (apps/server と packages/llm 横断で使う)

export type Turn = {
  turn_no: number;
  role: 'interviewer' | 'user';
  text: string;
  ts?: string;
};

export type Axes = {
  consistency: number;       // 0-5
  clarity: number;
  demeanor: number;
  self_understanding: number;
  target_fit: number;
  depth_resilience: number;
};

export type Evaluation = {
  turn_range: [number, number];
  axes: Partial<Axes>;
  comment: string;
  hints: string[];
  model: string;
};

export type SummaryDoc = {
  headline: string;
  highlights: { turn_no: number; comment: string }[];
  axes_summary: {
    final: Partial<Axes>;
    ema_delta?: Partial<Axes>;
  };
  growth_points: string[];
  carry_over: string[];
  interviewer_note: string;
};

export type CritiqueItem = {
  turn_no: number;
  examinee_answer: string;
  better_answer: string;
  axes_lifted: (keyof Axes)[];
  rationale: string;
};

export type CritiqueDoc = {
  per_turn: CritiqueItem[];
};

export type InterviewerPersonaInput = {
  display_name: string;
  stage: 'hr' | 'peer-tech' | 'lead-tech' | 'final';
  role_lens: string;
  temperament: string;
  pressure: number;
  tics: string[];
  bio: string;
  evaluation_bias: Record<string, number>;
};

export type ExamineePersonaInput = {
  display_name: string;
  background: string;
  target_role: string;
  weakness_axes: Record<string, number>;
  strengths: string[];
  speech_style: string;
  intentional_flaws: string[];
  bio: string;
};
