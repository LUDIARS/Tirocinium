import OpenAI from 'openai';

export type OpenAIConfig = {
  apiKey?: string;
};

export function createOpenAIClient(opts: OpenAIConfig = {}): OpenAI {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  return new OpenAI({ apiKey });
}

/** 既定モデル。 GPT-5.5 が公開されたら env で差し替える。 暫定は gpt-4o */
export const OPENAI_MODEL = {
  REFINE: process.env['OPENAI_MODEL_REFINE'] ?? 'gpt-4o',
} as const;
