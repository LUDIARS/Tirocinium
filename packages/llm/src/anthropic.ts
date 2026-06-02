import Anthropic from '@anthropic-ai/sdk';

export type AnthropicConfig = {
  apiKey?: string;
};

export function createAnthropicClient(opts: AnthropicConfig = {}): Anthropic {
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  return new Anthropic({ apiKey });
}

export const MODEL = {
  RESPONSE: 'claude-sonnet-4-6',
  EVALUATOR: 'claude-opus-4-7',
  SUMMARIZER: 'claude-opus-4-7',
  CRITIC: 'claude-opus-4-7',
  EXAMINEE: 'claude-haiku-4-5-20251001',
  JUDGE: 'claude-haiku-4-5-20251001',
} as const;

export function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
