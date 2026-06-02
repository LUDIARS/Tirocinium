// マイク → 16kHz mono PCM(s16le) を取得し、~100ms チャンクの「バイト列 (0-255)」を
// コールバックする。バイト列はそのまま WS の audio_chunk フレーム (pcm: number[]) に載る
// (server 側は new Uint8Array(pcm) で s16le bytes として扱う)。

export type PcmBytesHandler = (bytes: number[]) => void;

export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  /** マイクを開き、PCM バイト列の供給を開始する。 */
  async start(onBytes: PcmBytesHandler): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // 16kHz を直接要求 (Chromium/WebView2 は honor する) → リサンプル不要
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const workletUrl = new URL('./pcm-processor.js', import.meta.url);
    await this.ctx.audioWorklet.addModule(workletUrl);

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-processor');
    this.node.port.onmessage = (e: MessageEvent<Int16Array>) => {
      const pcm = e.data;
      const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      onBytes(Array.from(bytes));
    };
    // destination には繋がない (スピーカーへのエコー回避)。input があれば process は回る。
    this.source.connect(this.node);
  }

  /** 取得を停止し、リソースを解放する。 */
  async stop(): Promise<void> {
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      await this.ctx?.close();
    } finally {
      this.ctx = null;
      this.stream = null;
      this.node = null;
      this.source = null;
    }
  }
}
