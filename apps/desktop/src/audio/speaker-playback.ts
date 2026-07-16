// 面接官 TTS (tts_chunk frame) の PCM s16le を WebAudio で逐次再生する。
// spec/feature/voice/voicevox-tts.md §6。
// chunk 到着ごとに AudioBuffer を作り、前 chunk の末尾に隙間なくスケジュールする。
// barge-in / セッション終了時は stop() でキューごと破棄する。

export class SpeakerPlayback {
  private ctx: AudioContext | null = null;
  private nextTime = 0;

  /** PCM s16le バイト列 (number[]) を再生キューに積む。 */
  play(pcm: number[], sampleRate: number, channels: number): void {
    if (pcm.length < 2 * channels) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.nextTime = 0;
    }
    const ctx = this.ctx;
    const bytes = new Uint8Array(pcm);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const frames = Math.floor(bytes.byteLength / 2 / channels);
    if (frames === 0) return;

    const buf = ctx.createBuffer(channels, frames, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        data[i] = view.getInt16((i * channels + ch) * 2, true) / 32768;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextTime);
    src.start(startAt);
    this.nextTime = startAt + buf.duration;
  }

  /** 再生を打ち切り、スケジュール済み chunk も破棄する (barge-in / 終了)。 */
  stop(): void {
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
      this.nextTime = 0;
    }
  }
}
