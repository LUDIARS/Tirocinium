export type Turn = {
  turn_no: number;
  role: 'interviewer' | 'user';
  text: string;
};

export type AxisScore = {
  axis: string;
  score: number;
  comment: string;
  hint: string;
};

export type Evaluation = {
  turn_no?: number;
  axes: AxisScore[];
  overall?: string;
};

export type Highlight = {
  turn_no: number;
  comment: string;
};

export type AxisSummary = {
  axis: string;
  score: number;
  ema_comparison?: string;
};

export type Summary = {
  headline: string;
  highlights: Highlight[];
  axes_summary: AxisSummary[];
  growth_points: string[];
  carry_over: string[];
  interviewer_note: string;
};

export type FeedbackAction = 'accepted' | 'rejected' | { edited: string };
