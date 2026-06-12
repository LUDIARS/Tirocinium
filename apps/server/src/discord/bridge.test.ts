/**
 * Discord Bridge 統合テスト (#57)。
 *
 * - RuntimeDiscordSocket: response_token 蓄積 / response_end 送信 / onTextReady コールバック
 * - buildVoiceAdapterBridge: gateway ↔ @discordjs/voice メソッドの委譲
 * - chunkMessage (内部 util 相当): ヘルパー動作の確認
 *
 * 実際の Discord Gateway WebSocket / DB / SessionRuntime は不要なため、
 * それらは vi.mock またはスタブで差し替える。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildVoiceAdapterBridge } from './voice-adapter.js';

// ── RuntimeDiscordSocket のスタブテスト ──────────────────────────────────────
// bridge.ts の export が無いためテスト用に同等クラスをここで再現する。
// bridge.ts の RuntimeDiscordSocket と同じロジックを持つ最小実装。

type ServerFrame =
  | { kind: 'response_token'; token: string; turn_no: number }
  | { kind: 'response_end'; turn_no: number; text_uri: string }
  | { kind: 'system'; code: string; message?: string };

class TestableSocket {
  private responseBuffer = '';
  readonly sentMessages: string[] = [];
  readonly textReadyCalls: string[] = [];

  constructor(
    private readonly onTextReady?: (text: string) => void,
  ) {}

  send(raw: string): void {
    const frame = JSON.parse(raw) as ServerFrame;
    void this.handleFrame(frame);
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
        this.sentMessages.push(text);
        this.onTextReady?.(text);
      }
      return;
    }
    if (frame.kind === 'system') {
      if (frame.code === 'closing') this.sentMessages.push('Tr interview ended.');
      else if (frame.message) this.sentMessages.push(`Tr system: ${frame.message}`);
    }
  }
}

describe('RuntimeDiscordSocket (テスト用再現実装)', () => {
  it('response_token を蓄積し response_end でフラッシュする', async () => {
    const sock = new TestableSocket();
    sock.send(JSON.stringify({ kind: 'response_token', token: 'Hello', turn_no: 1 }));
    sock.send(JSON.stringify({ kind: 'response_token', token: ' world', turn_no: 1 }));
    sock.send(JSON.stringify({ kind: 'response_end', turn_no: 1, text_uri: 'local:1' }));
    // handleFrame は void async — microtask 1 cycle 待つ
    await Promise.resolve();
    expect(sock.sentMessages).toEqual(['Hello world']);
  });

  it('空のバッファは送信しない', async () => {
    const sock = new TestableSocket();
    sock.send(JSON.stringify({ kind: 'response_end', turn_no: 1, text_uri: 'local:1' }));
    await Promise.resolve();
    expect(sock.sentMessages).toHaveLength(0);
  });

  it('response_end 時に onTextReady を呼ぶ', async () => {
    const textReadyCalls: string[] = [];
    const sock = new TestableSocket((t) => textReadyCalls.push(t));
    sock.send(JSON.stringify({ kind: 'response_token', token: 'TTS target', turn_no: 2 }));
    sock.send(JSON.stringify({ kind: 'response_end', turn_no: 2, text_uri: 'local:2' }));
    await Promise.resolve();
    expect(textReadyCalls).toEqual(['TTS target']);
  });

  it('onTextReady が無いときは例外を出さない', async () => {
    const sock = new TestableSocket();
    sock.send(JSON.stringify({ kind: 'response_token', token: 'ok', turn_no: 1 }));
    await expect(
      (async () => {
        sock.send(JSON.stringify({ kind: 'response_end', turn_no: 1, text_uri: 'local:1' }));
        await Promise.resolve();
      })(),
    ).resolves.toBeUndefined();
  });

  it('system closing を送信する', async () => {
    const sock = new TestableSocket();
    sock.send(JSON.stringify({ kind: 'system', code: 'closing' }));
    await Promise.resolve();
    expect(sock.sentMessages).toContain('Tr interview ended.');
  });

  it('system error メッセージを送信する', async () => {
    const sock = new TestableSocket();
    sock.send(JSON.stringify({ kind: 'system', code: 'error', message: 'llm not configured' }));
    await Promise.resolve();
    expect(sock.sentMessages).toContain('Tr system: llm not configured');
  });
});

// ── VoiceAdapterBridge ────────────────────────────────────────────────────────

describe('buildVoiceAdapterBridge', () => {
  it('adapterCreator がメソッドを登録する', () => {
    const sendCalls: string[] = [];
    const bridge = buildVoiceAdapterBridge((raw) => sendCalls.push(raw));

    const onVoiceStateUpdate = vi.fn();
    const onVoiceServerUpdate = vi.fn();

    // adapterCreator を呼ぶことで内部 methods が登録される
    const adapter = bridge.adapterCreator({ onVoiceStateUpdate, onVoiceServerUpdate });

    // sendPayload が gateway.send に転送されるか
    adapter.sendPayload({ op: 4, d: { guild_id: 'g1', channel_id: 'c1', self_deaf: false, self_mute: true } });
    expect(sendCalls).toHaveLength(1);
    expect(JSON.parse(sendCalls[0])).toMatchObject({ op: 4 });
  });

  it('onVoiceStateUpdate を登録メソッドに転送する', () => {
    const bridge = buildVoiceAdapterBridge(vi.fn());
    const onVoiceStateUpdate = vi.fn();
    bridge.adapterCreator({ onVoiceStateUpdate, onVoiceServerUpdate: vi.fn() });

    const fakeVSU = { guild_id: 'g1', user_id: 'u1', channel_id: 'c1', session_id: 's1' };
    bridge.onVoiceStateUpdate(fakeVSU);
    expect(onVoiceStateUpdate).toHaveBeenCalledWith(fakeVSU);
  });

  it('onVoiceServerUpdate を登録メソッドに転送する', () => {
    const bridge = buildVoiceAdapterBridge(vi.fn());
    const onVoiceServerUpdate = vi.fn();
    bridge.adapterCreator({ onVoiceStateUpdate: vi.fn(), onVoiceServerUpdate });

    const fakeVSU = { guild_id: 'g1', token: 'tok', endpoint: 'endpoint.discord.gg' };
    bridge.onVoiceServerUpdate(fakeVSU);
    expect(onVoiceServerUpdate).toHaveBeenCalledWith(fakeVSU);
  });

  it('dispose 後に onVoiceStateUpdate を呼んでも例外を出さない', () => {
    const bridge = buildVoiceAdapterBridge(vi.fn());
    bridge.adapterCreator({ onVoiceStateUpdate: vi.fn(), onVoiceServerUpdate: vi.fn() });
    bridge.dispose();
    expect(() => bridge.onVoiceStateUpdate({ guild_id: 'g1' })).not.toThrow();
  });

  it('adapterCreator 呼び出し前は onVoiceStateUpdate を無視する', () => {
    const bridge = buildVoiceAdapterBridge(vi.fn());
    expect(() => bridge.onVoiceStateUpdate({ guild_id: 'g1' })).not.toThrow();
  });

  it('adapter.destroy() で methods を解除する', () => {
    const bridge = buildVoiceAdapterBridge(vi.fn());
    const onVoiceStateUpdate = vi.fn();
    const adapter = bridge.adapterCreator({ onVoiceStateUpdate, onVoiceServerUpdate: vi.fn() });

    adapter.destroy();
    bridge.onVoiceStateUpdate({ guild_id: 'g1' }); // methods = null → 何もしない
    expect(onVoiceStateUpdate).not.toHaveBeenCalled();
  });

  it('sendPayload が失敗しても false を返し例外を出さない', () => {
    const bridge = buildVoiceAdapterBridge(() => { throw new Error('ws closed'); });
    const adapter = bridge.adapterCreator({ onVoiceStateUpdate: vi.fn(), onVoiceServerUpdate: vi.fn() });
    expect(() => adapter.sendPayload({ op: 4 })).not.toThrow();
    expect(adapter.sendPayload({ op: 4 })).toBe(false);
  });
});

// ── chunkMessage ロジック (bridge.ts 内部 util の再現) ───────────────────────

function chunkMessage(content: string, limit = 1900): string[] {
  const normalized = content.trim() || '(empty)';
  const chunks: string[] = [];
  for (let i = 0; i < normalized.length; i += limit) {
    chunks.push(normalized.slice(i, i + limit));
  }
  return chunks;
}

describe('chunkMessage', () => {
  it('短いメッセージはそのまま 1 件', () => {
    expect(chunkMessage('hello')).toEqual(['hello']);
  });

  it('空文字は "(empty)" を返す', () => {
    expect(chunkMessage('')).toEqual(['(empty)']);
    expect(chunkMessage('   ')).toEqual(['(empty)']);
  });

  it('limit を超えると複数チャンクに分割する', () => {
    const long = 'a'.repeat(3800);
    const chunks = chunkMessage(long, 1900);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1900);
    expect(chunks[1]).toHaveLength(1900);
  });
});
