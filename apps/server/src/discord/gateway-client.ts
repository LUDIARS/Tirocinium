// 再利用可能な最小 Discord Gateway + REST クライアント。
// 本体/面接の Bot A (bridge.ts) は音声等の固有処理を持つため独自実装のまま。
// 裏口の Bot B (backdoor-bot.ts) はこの汎用クライアントを使う (別 token = 別管理)。
//
// 提供: gateway 接続 / heartbeat / identify / MESSAGE_CREATE 配送 / メッセージ送信 / DM 送信。

import { WebSocket } from 'ws';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const MESSAGE_LIMIT = 1900;

export type GatewayMessageAuthor = {
  id: string;
  bot?: boolean;
  username?: string;
  global_name?: string | null;
};

export type GatewayMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: GatewayMessageAuthor;
};

export type DiscordRest = {
  sendMessage(channelId: string, content: string): Promise<void>;
  /** DM チャンネルを開いて本人に直接送る (マジックリンク配布用)。 */
  sendDirectMessage(userId: string, content: string): Promise<void>;
};

export type GatewayHandle = {
  stop(): void;
  rest: DiscordRest;
};

export type GatewayOptions = {
  token: string;
  intents: number;
  appName: string;
  onMessage?: (msg: GatewayMessage, rest: DiscordRest) => Promise<void> | void;
  onReady?: (botUserId: string) => void;
};

type GatewayPayload = { op: number; d?: unknown; s?: number; t?: string };

export function chunkContent(content: string): string[] {
  const normalized = content.trim() || '(empty)';
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += MESSAGE_LIMIT) {
    chunks.push(normalized.slice(i, i + MESSAGE_LIMIT));
  }
  return chunks;
}

export function startGateway(opts: GatewayOptions): GatewayHandle {
  const gateway = new WebSocket(DISCORD_GATEWAY);
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let sequence: number | null = null;

  const rest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${opts.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`discord rest ${res.status}: ${body}`);
    }
    return (await res.json()) as T;
  };

  const sendMessage = async (channelId: string, content: string): Promise<void> => {
    for (const chunk of chunkContent(content)) {
      await rest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: chunk }),
      });
    }
  };

  const sendDirectMessage = async (userId: string, content: string): Promise<void> => {
    const dm = await rest<{ id: string }>(`/users/@me/channels`, {
      method: 'POST',
      body: JSON.stringify({ recipient_id: userId }),
    });
    await sendMessage(dm.id, content);
  };

  const restApi: DiscordRest = { sendMessage, sendDirectMessage };

  gateway.on('message', (raw) => {
    void (async () => {
      const payload = JSON.parse(raw.toString()) as GatewayPayload;
      if (typeof payload.s === 'number') sequence = payload.s;
      if (payload.op === 10) {
        const hello = payload.d as { heartbeat_interval: number };
        heartbeatTimer = setInterval(() => {
          gateway.send(JSON.stringify({ op: 1, d: sequence }));
        }, hello.heartbeat_interval);
        gateway.send(JSON.stringify({
          op: 2,
          d: {
            token: opts.token,
            intents: opts.intents,
            properties: { os: process.platform, browser: opts.appName, device: opts.appName },
          },
        }));
        return;
      }
      if (payload.t === 'READY') {
        const ready = payload.d as { user?: { id: string } };
        console.log(`[discord:${opts.appName}] gateway ready`);
        if (ready.user?.id) opts.onReady?.(ready.user.id);
        return;
      }
      if (payload.t === 'MESSAGE_CREATE') {
        await opts.onMessage?.(payload.d as GatewayMessage, restApi);
        return;
      }
    })().catch((err) => console.error(`[discord:${opts.appName}] error`, err));
  });

  gateway.on('error', (err) => console.error(`[discord:${opts.appName}] gateway error`, err));

  return {
    rest: restApi,
    stop: () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      gateway.close();
    },
  };
}
