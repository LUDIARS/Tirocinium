// 単発の system+user 補完を行う backend 非依存ヘルパ。
// config.llmBackend に応じて Anthropic API (鍵必須) か claude CLI (鍵不要・ローカル) を選ぶ。
// enrich.ts は API 固定だが、 こちらは cli backend のローカル環境でも動く。

import { createAnthropicClient, extractText, runClaudeCli, MODEL, type ClaudeCliModel, type ModelRole } from '@tirocinium/llm';
import { config } from '../config.js';

export type Completer = (system: string, user: string) => Promise<string>;

const CLI_MODEL: Partial<Record<ModelRole, ClaudeCliModel>> = {
  EXTRACTOR: 'haiku',
  SUMMARIZER: 'sonnet',
  RECOMMENDER: 'sonnet',
};

/** role に応じたモデルで 1 回補完する Completer を作る。 */
export function createCompleter(role: ModelRole = 'SUMMARIZER'): { complete: Completer; modelLabel: string } {
  if (config.llmBackend === 'cli') {
    const model = CLI_MODEL[role] ?? 'sonnet';
    return {
      modelLabel: `claude-cli:${model}`,
      complete: (system, user) => runClaudeCli(`${system}\n\n---\n\n${user}`, model),
    };
  }
  const client = createAnthropicClient();
  const model = MODEL[role];
  return {
    modelLabel: model,
    complete: async (system, user) => {
      const res = await client.messages.create({
        model,
        max_tokens: 1500,
        system,
        messages: [{ role: 'user', content: user }],
      });
      return extractText(res.content);
    },
  };
}
