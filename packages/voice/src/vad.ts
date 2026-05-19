import type { VadState } from './types.js';

/** Energy-based 単純 VAD。 実装簡素化のための暫定実装で、
 *  本格運用は webrtc-vad-node 等への置換を検討。 */
export class SimpleEnergyVad {
  private window: number[] = [];
  private state: VadState = 'silence';
  private silenceMs = 0;
  private speechMs = 0;

  constructor(
    private readonly sampleRate: number = 16000,
    private readonly threshold = 0.01,
    private readonly silenceMsToEnd = 600,
    private readonly speechMsToStart = 100,
    private readonly windowMs = 20,
  ) {}

  /** PCM (Float32 normalized -1..1) の chunk を投入。 状態遷移時のみ kind を返す。 */
  feed(pcm: Float32Array): VadState | null {
    if (pcm.length === 0) return null;
    const frameSamples = (this.sampleRate * this.windowMs) / 1000;
    const energy = rms(pcm);
    this.window.push(energy);
    if (this.window.length > 50) this.window.shift();

    const isSpeech = energy > this.threshold;
    const frameDurMs = (pcm.length / this.sampleRate) * 1000;

    if (isSpeech) {
      this.speechMs += frameDurMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameDurMs;
      this.speechMs = 0;
    }

    if (this.state === 'silence' && this.speechMs >= this.speechMsToStart) {
      this.state = 'speech';
      return 'speech';
    }
    if (this.state === 'speech' && this.silenceMs >= this.silenceMsToEnd) {
      this.state = 'silence';
      return 'silence';
    }
    return null;
  }

  getState(): VadState {
    return this.state;
  }
}

export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i]!;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / pcm.length);
}
