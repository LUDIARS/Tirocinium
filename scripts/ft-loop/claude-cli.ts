// claude CLI ヘルパーは @tirocinium/llm に共通化された。
// ft-loop は薄い re-export 経由で利用する (実体は packages/llm/src/cli.ts)。
export { runClaudeCli, type ClaudeCliModel } from '@tirocinium/llm';
