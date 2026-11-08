// Anthropic Messages API のうち、Tirocinium が使う範囲だけの型。
// 旧 @anthropic-ai/sdk の型の置き換え (呼び出し側の `client.messages.create(...)` の形は変えない)。

export type MessageParam = {
  role: 'user' | 'assistant';
  content: string;
};

export type MessageCreateParams = {
  model: string;
  max_tokens: number;
  system?: string;
  temperature?: number;
  messages: MessageParam[];
};

export type TextBlock = { type: 'text'; text: string };

/** text 以外のブロック (tool_use など) は読まないので中身を問わない */
export type ContentBlock = TextBlock | { type: string; [key: string]: unknown };

export type Message = {
  id?: string;
  role?: 'assistant';
  model?: string;
  content: ContentBlock[];
  stop_reason?: string | null;
};

/** stream の 1 イベント (SSE の data を JSON にしたもの)。使うのは content_block_delta の text_delta だけ */
export type MessageStreamEvent = {
  type: string;
  delta?: { type: string; text?: string };
  [key: string]: unknown;
};

/** createAnthropicClient が返すクライアント。旧 SDK の `Anthropic` インスタンスのうち使っていた部分 */
export interface AnthropicApi {
  messages: {
    create(params: MessageCreateParams): Promise<Message>;
    stream(params: MessageCreateParams, options?: { signal?: AbortSignal }): AsyncIterable<MessageStreamEvent>;
  };
}
