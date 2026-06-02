// AudioWorklet processor: マイク Float32 を 16-bit PCM (s16le) に変換し、
// ~100ms ぶん貯めてから main スレッドへ転送する。
// AudioContext({ sampleRate: 16000 }) で動かす前提なのでリサンプルは不要。
// (Vite が new URL('./pcm-processor.js', import.meta.url) で URL 解決する)

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._target = 1600; // 100ms @ 16kHz
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this._buf.push(ch[i]);
      while (this._buf.length >= this._target) {
        const slice = this._buf.splice(0, this._target);
        const pcm = new Int16Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
          const s = Math.max(-1, Math.min(1, slice[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(pcm, [pcm.buffer]);
      }
    }
    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PcmProcessor);
