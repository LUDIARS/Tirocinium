import { WebSocket } from 'ws';
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import { createIvClient } from '@tirocinium/voice';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { listInterviewers } from '../persona/repo.js';
import { tryStart } from '../reservation/coordinator.js';
import { SessionRuntime } from '../ws/session-runtime.js';
import type { ServerFrame } from '../ws/frames.js';
import { parseDiscordCommand, renderDiscordHelp, type DiscordInterviewMode } from './commands.js';
import { buildVoiceAdapterBridge, type VoiceAdapterBridge } from './voice-adapter.js';
import { subscribeVoiceAudio, createTtsPlayer, playTts } from './voice-bridge.js';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
// GUILDS(1) | GUILD_VOICE_STATES(128) | GUILD_MESSAGES(512) | MESSAGE_CONTENT(32768)
const INTENTS = 1 | 128 | 512 | 32768;
const DISCORD_MESSAGE_LIMIT = 1900;

type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
};

type DiscordAuthor = {
  id: string;
  bot?: boolean;
};

type DiscordMessage = {
  id: string;
  channel_id: string;
  guild_id?: string;
  content: string;
  author: DiscordAuthor;
};

type ActiveDiscordSession = {
  mode: DiscordInterviewMode;
  sessionId: string;
  runtime: SessionRuntime;
  socket: RuntimeDiscordSocket;
  guildId?: string;
  voiceConnection?: VoiceConnection;
  audioPlayer?: AudioPlayer;
};

class RuntimeDiscordSocket {
  readonly OPEN = 1;
  readyState = this.OPEN;
  private responseBuffer = '';

  constructor(
    private readonly channelId: string,
    private readonly sendMessage: (channelId: string, content: string) => Promise<void>,
    private readonly onTextReady?: (text: string) => void,
  ) {}

  send(raw: string): void {
    const frame = JSON.parse(raw) as ServerFrame;
    void this.handleFrame(frame);
  }

  close(): void {
    this.readyState = 3;
  }

  private async handleFrame(frame: ServerFrame): Promise<void> {
    if (frame.kind === 'response_token') {
      this.responseBuffer += frame.token;
      return;
    }
    if (frame.kind === 'response_end') {
      const text = this.responseBuffer.trim();
      this.responseBuffer = '';
      if (text) {
        await this.sendMessage(this.channelId, text);
        this.onTextReady?.(text);
      }
      return;
    }
    if (frame.kind === 'system') {
      if (frame.code === 'closing') {
        await this.sendMessage(this.channelId, 'Tr interview ended.');
      } else if (frame.message) {
        await this.sendMessage(this.channelId, `Tr system: ${frame.message}`);
      }
    }
  }
}

export async function startDiscordBridge(): Promise<() => void> {
  if (!config.discord.botToken) {
    return () => undefined;
  }

  const activeSessions = new Map<string, ActiveDiscordSession>();
  const voiceAdapters = new Map<string, VoiceAdapterBridge>();
  const gateway = new WebSocket(DISCORD_GATEWAY);
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let sequence: number | null = null;
  let botUserId: string | null = null;

  const rest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(`${DISCORD_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${config.discord.botToken}`,
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
    const chunks = chunkMessage(content);
    for (const chunk of chunks) {
      await rest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: chunk }),
      });
    }
  };

  const createVoiceRoom = async (guildId: string, target: string): Promise<string> => {
    const room = await rest<{ id: string }>(`/guilds/${guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        name: `Tr MTG${target ? ` - ${target}` : ''}`.slice(0, 90),
        type: 2,
        parent_id: config.discord.categoryId || undefined,
      }),
    });
    return room.id;
  };

  const startSession = async (
    channelId: string,
    guildId: string | undefined,
    mode: DiscordInterviewMode,
    target: string,
  ): Promise<void> => {
    if (activeSessions.has(channelId)) {
      await sendMessage(channelId, 'This channel already has an active Tr interview. Use `!tr end` first.');
      return;
    }

    await sql`INSERT INTO users (id) VALUES (${config.devUserId}) ON CONFLICT (id) DO NOTHING`;
    const decision = await tryStart(config.devUserId);
    if (decision.kind !== 'start') {
      await sendMessage(channelId, decision.kind === 'offer'
        ? `Tr is busy. Next slot: ${decision.slotStart.toISOString()}`
        : `Tr cannot start: ${decision.reason}`);
      return;
    }

    const interviewers = await listInterviewers();
    const interviewerId = interviewers[0]?.id;
    if (interviewerId || target) {
      await sql`
        UPDATE sessions SET
          metadata = metadata || ${sql.json({ interviewer_id: interviewerId ?? null })},
          target_role = COALESCE(${target || null}, target_role)
        WHERE id = ${decision.sessionId}
      `;
    }

    // TTS 用 ivClient (voice mode のみ使用; tts() は現状 stub)
    const ivClientForTts = mode === 'voice' ? createIvClient() : null;

    const onTextReady = (mode === 'voice' && ivClientForTts)
      ? (text: string) => {
          const s = activeSessions.get(channelId);
          if (s?.audioPlayer) void playTts(text, s.audioPlayer, ivClientForTts);
        }
      : undefined;

    const socket = new RuntimeDiscordSocket(channelId, sendMessage, onTextReady);
    const runtime = new SessionRuntime(
      socket as unknown as ConstructorParameters<typeof SessionRuntime>[0],
      decision.sessionId,
      config.devUserId,
    );
    activeSessions.set(channelId, { mode, sessionId: decision.sessionId, runtime, socket });

    await runtime.init();

    if (mode === 'voice') {
      const guildIdResolved = guildId ?? config.discord.guildId;
      if (!guildIdResolved) {
        await sendMessage(channelId, 'Voice mode needs a Discord guild id.');
      } else {
        const roomId = await createVoiceRoom(guildIdResolved, target);
        await sendMessage(channelId, `Created MTG voice room: <#${roomId}>`);

        // Voice adapter: gateway ↔ @discordjs/voice を橋渡し
        const voiceBridge = buildVoiceAdapterBridge((raw) => gateway.send(raw));
        voiceAdapters.set(guildIdResolved, voiceBridge);

        const connection = joinVoiceChannel({
          channelId: roomId,
          guildId: guildIdResolved,
          adapterCreator: voiceBridge.adapterCreator,
          selfDeaf: false,
          selfMute: true,
        });

        const session = activeSessions.get(channelId);
        if (session) {
          session.guildId = guildIdResolved;
          session.voiceConnection = connection;
        }

        // 接続完了後に STT 受信 + TTS player をセットアップ (非同期)
        void entersState(connection, VoiceConnectionStatus.Ready, 30_000)
          .then(() => {
            subscribeVoiceAudio(connection, botUserId ?? '', runtime);
            const player = createTtsPlayer(connection);
            const s = activeSessions.get(channelId);
            if (s) s.audioPlayer = player;
          })
          .catch((err: Error) => {
            console.error('[discord/voice] join timeout', err.message);
            void sendMessage(channelId, 'Voice channel connection timed out. Text mode is still active.');
          });
      }
    }

    await sendMessage(channelId, `Started Tr ${mode} interview. Tr will ask first.`);
    await runtime.onMessage(JSON.stringify({ kind: 'start_interview' }));
  };

  const endSession = async (channelId: string): Promise<void> => {
    const active = activeSessions.get(channelId);
    if (!active) {
      await sendMessage(channelId, 'No active Tr interview in this channel.');
      return;
    }
    await active.runtime.onMessage(JSON.stringify({ kind: 'end_session' }));
    await active.runtime.close();
    active.socket.close();

    if (active.voiceConnection) {
      active.voiceConnection.destroy();
    }
    if (active.guildId) {
      voiceAdapters.get(active.guildId)?.dispose();
      voiceAdapters.delete(active.guildId);
    }

    activeSessions.delete(channelId);
  };

  const handleMessageCreate = async (message: DiscordMessage): Promise<void> => {
    if (message.author.bot) return;
    if (
      config.discord.allowedChannelIds.length > 0 &&
      !config.discord.allowedChannelIds.includes(message.channel_id)
    ) {
      return;
    }

    const command = parseDiscordCommand(message.content, config.discord.commandPrefix);
    if (command.kind === 'help') {
      await sendMessage(message.channel_id, renderDiscordHelp(config.discord.commandPrefix));
      return;
    }
    if (command.kind === 'end') {
      await endSession(message.channel_id);
      return;
    }
    if (command.kind === 'start') {
      await startSession(message.channel_id, message.guild_id, command.mode, command.target);
      return;
    }
    if (command.kind === 'none') {
      const active = activeSessions.get(message.channel_id);
      if (!active) return;
      // voice mode でも text fallback として受け付ける
      await active.runtime.onMessage(JSON.stringify({ kind: 'stt_final', text: message.content }));
    }
  };

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
            token: config.discord.botToken,
            intents: INTENTS,
            properties: {
              os: process.platform,
              browser: 'tirocinium',
              device: 'tirocinium',
            },
          },
        }));
        return;
      }
      if (payload.t === 'READY') {
        const ready = payload.d as { user?: { id: string } };
        botUserId = ready.user?.id ?? null;
        console.log('[discord] bridge ready');
        return;
      }
      if (payload.t === 'MESSAGE_CREATE') {
        await handleMessageCreate(payload.d as DiscordMessage);
        return;
      }
      // voice gateway 連携: @discordjs/voice の adapter に転送
      if (payload.t === 'VOICE_STATE_UPDATE') {
        const d = payload.d as { guild_id?: string };
        if (d.guild_id) voiceAdapters.get(d.guild_id)?.onVoiceStateUpdate(payload.d);
        return;
      }
      if (payload.t === 'VOICE_SERVER_UPDATE') {
        const d = payload.d as { guild_id?: string };
        if (d.guild_id) voiceAdapters.get(d.guild_id)?.onVoiceServerUpdate(payload.d);
        return;
      }
    })().catch((err) => console.error('[discord] bridge error', err));
  });

  gateway.on('error', (err) => console.error('[discord] gateway error', err));

  return () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    for (const active of activeSessions.values()) {
      void active.runtime.close();
      active.socket.close();
      active.voiceConnection?.destroy();
    }
    for (const adapter of voiceAdapters.values()) {
      adapter.dispose();
    }
    voiceAdapters.clear();
    activeSessions.clear();
    gateway.close();
  };
}

function chunkMessage(content: string): string[] {
  const normalized = content.trim() || '(empty)';
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += DISCORD_MESSAGE_LIMIT) {
    chunks.push(normalized.slice(i, i + DISCORD_MESSAGE_LIMIT));
  }
  return chunks;
}
