// VOICEVOX の wav (16bit PCM / mono) を、発話の開始時刻どおりに 1 本の wav へ並べる。
import { readFileSync, writeFileSync } from 'node:fs';

type Pcm = { rate: number; samples: Int16Array };

function readWav(path: string): Pcm {
  const buf = readFileSync(path);
  let off = 12;
  let rate = 24000;
  let channels = 1;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10);
      rate = buf.readUInt32LE(off + 12);
      if (buf.readUInt16LE(off + 22) !== 16) throw new Error(`${path}: 16bit PCM only`);
    } else if (id === 'data') {
      const data = buf.subarray(off + 8, off + 8 + size);
      const all = new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      if (channels === 1) return { rate, samples: all };
      const mono = new Int16Array(all.length / channels);
      for (let i = 0; i < mono.length; i += 1) mono[i] = all[i * channels]!;
      return { rate, samples: mono };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

export function mixTimeline(clips: { path: string; start: number }[], duration: number, outPath: string): void {
  const first = readWav(clips[0]!.path);
  const rate = first.rate;
  const mix = new Int32Array(Math.ceil(duration * rate));
  for (const c of clips) {
    const pcm = readWav(c.path);
    if (pcm.rate !== rate) throw new Error(`sample rate mismatch: ${c.path}`);
    const at = Math.round(c.start * rate);
    for (let i = 0; i < pcm.samples.length && at + i < mix.length; i += 1) mix[at + i]! += pcm.samples[i]!;
  }
  const out = Buffer.alloc(44 + mix.length * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + mix.length * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(mix.length * 2, 40);
  for (let i = 0; i < mix.length; i += 1) out.writeInt16LE(Math.max(-32768, Math.min(32767, mix[i]!)), 44 + i * 2);
  writeFileSync(outPath, out);
}
