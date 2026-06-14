/**
 * @discordjs/voice と生 WebSocket gateway を繋ぐ custom adapter。
 *
 * joinVoiceChannel には discord.js Client が不要 — adapterCreator だけ渡せばよい。
 * gateway の VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE を
 * onVoiceStateUpdate / onVoiceServerUpdate() で受け取り @discordjs/voice に委譲する。
 *
 * 寿命: VoiceConnection.destroy() → adapter.destroy() の順で呼ばれる。
 * guildId → adapter の Map は bridge.ts が管理する。
 */

import type {
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
} from '@discordjs/voice';

/** gateway.send の raw 文字列版 (JSON.stringify 済) */
type GatewaySendFn = (raw: string) => void;

export interface VoiceAdapterBridge {
  adapterCreator: DiscordGatewayAdapterCreator;
  onVoiceStateUpdate(data: unknown): void;
  onVoiceServerUpdate(data: unknown): void;
  dispose(): void;
}

export function buildVoiceAdapterBridge(gatewaySend: GatewaySendFn): VoiceAdapterBridge {
  let methods: DiscordGatewayAdapterLibraryMethods | null = null;

  const adapterCreator: DiscordGatewayAdapterCreator = (m) => {
    methods = m;
    return {
      sendPayload(data) {
        try {
          gatewaySend(JSON.stringify(data));
          return true;
        } catch {
          return false;
        }
      },
      destroy() {
        methods = null;
      },
    };
  };

  return {
    adapterCreator,
    onVoiceStateUpdate(data) {
      type Arg = Parameters<DiscordGatewayAdapterLibraryMethods['onVoiceStateUpdate']>[0];
      methods?.onVoiceStateUpdate(data as Arg);
    },
    onVoiceServerUpdate(data) {
      type Arg = Parameters<DiscordGatewayAdapterLibraryMethods['onVoiceServerUpdate']>[0];
      methods?.onVoiceServerUpdate(data as Arg);
    },
    dispose() {
      methods = null;
    },
  };
}
