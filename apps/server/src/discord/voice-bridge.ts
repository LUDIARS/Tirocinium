/**
 * Discord VC 音声受信 (STT) と TTS 再生の実装。
 *
 * - subscribeVoiceAudio: 発話者の Opus ストリームを PCM に変換して
 *   SessionRuntime の audio_chunk フレームに流す。
 * - createTtsPlayer: TTS 再生用 AudioPlayer を作成して connection に購読させる。
 * - playTts: ImperativusClient.tts() の PCM を AudioPlayer で再生する
 *   (現在 tts() は stub なので接続のみで音声は出ない)。
 *
 * STT フォーマット: 16kHz mono s16le (Iv STT が要求する仕様)。
 * TTS フォーマット: Discord が期待する 48kHz stereo s16le (StreamType.Raw)。
 *   Iv の tts() が固まったら format を揃えて Resource を生成すること。
 */

import { Readable } from 'node:stream';
import {
  EndBehaviorType,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  NoSubscriberBehavior,
  type VoiceConnection,
  type AudioPlayer,
} from '@discordjs/voice';
import type { ImperativusClient } from '@tirocinium/voice';
import type { SessionRuntime } from '../ws/session-runtime.js';

// prism-media は CJS モジュール。ESM interop で default import する。
// @discordjs/voice が peerDep として要求しているため、インストール済み前提。
import prism from 'prism-media';

/** STT 用 Opus → PCM 変換パラメータ (Iv STT が要求する 16kHz mono) */
const STT_RATE = 16000;
const STT_CHANNELS = 1;
const STT_FRAME_SIZE = 320; // 20ms @ 16kHz

type OpusDecoderCtor = {
  new (opts: { rate: number; channels: number; frameSize: number }): import('node:stream').Transform;
};

const OpusDecoder = (prism as unknown as { opus: { Decoder: OpusDecoderCtor } }).opus.Decoder;

/**
 * voice channel の発話を SessionRuntime の audio_chunk に流す。
 *
 * @discordjs/voice の speaking.start イベントで発話者ごとに Opus ストリームを
 * 購読し、 prism-media で PCM に変換して runtime.onMessage() に送る。
 * botUserId の発話は無視する。
 */
export function subscribeVoiceAudio(
  connection: VoiceConnection,
  botUserId: string,
  runtime: SessionRuntime,
): void {
  const receiver = connection.receiver;
  const activeSpeakers = new Set<string>();

  receiver.speaking.on('start', (userId: string) => {
    if (userId === botUserId) return;
    if (activeSpeakers.has(userId)) return;
    activeSpeakers.add(userId);

    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
    });

    let decoder: import('node:stream').Transform;
    try {
      decoder = new OpusDecoder({ rate: STT_RATE, channels: STT_CHANNELS, frameSize: STT_FRAME_SIZE });
    } catch (err) {
      console.error('[voice] opus decoder init failed — opusscript インストール済みか確認', err);
      activeSpeakers.delete(userId);
      return;
    }

    opusStream.pipe(decoder as unknown as import('node:stream').Writable);

    let seq = 0;
    decoder.on('data', (chunk: Buffer) => {
      void runtime.onMessage(JSON.stringify({
        kind: 'audio_chunk',
        pcm: Array.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
        seq: seq++,
      }));
    });

    decoder.on('error', (err: Error) => console.error('[voice] pcm decoder error', err));
    opusStream.on('end', () => {
      activeSpeakers.delete(userId);
      decoder.destroy();
    });
  });
}

/**
 * TTS 再生用 AudioPlayer を作成して connection に購読させる。
 * player.play(resource) で再生を開始できる状態にする。
 */
export function createTtsPlayer(connection: VoiceConnection): AudioPlayer {
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
  connection.subscribe(player);
  return player;
}

/**
 * ImperativusClient.tts() の PCM ストリームを AudioPlayer で Discord VC に流す。
 *
 * ivClient.tts() は現在 stub (何も yield しない) なので実際に音は出ないが、
 * Iv の TTS 経路が実装されたときにそのまま動く構造にしている。
 *
 * 期待する PCM フォーマット: 48kHz stereo s16le (Discord StreamType.Raw)。
 * Iv の出力が 16kHz mono の場合は FFmpeg によるリサンプリングが必要 (TODO)。
 */
export async function playTts(
  text: string,
  player: AudioPlayer,
  ivClient: ImperativusClient,
): Promise<void> {
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of ivClient.tts({ text })) {
      chunks.push(chunk);
    }
  } catch (err) {
    console.error('[voice] tts stream error', err);
    return;
  }
  if (chunks.length === 0) return;

  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const resource = createAudioResource(Readable.from([buf]), { inputType: StreamType.Raw });
  player.play(resource);
}
