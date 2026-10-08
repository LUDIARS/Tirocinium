// VOICEVOX が使えないときの動作確認用: 文字から仮のモーラ列と無音 wav を作る。
// 口の形は正確でないが、発話の長さ・文節の切れ目・問いかけは本物と同じ扱いになるので、動きの確認に使える。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoicevoxQuery } from '../../packages/avatar/src/index.js';
import type { Synth } from './voicevox.js';

const ROWS = ['あかさたなはまやらわがざだばぱぁゃ', 'いきしちにひみりぎじぢびぴぃ', 'うくすつぬふむゆるぐずづぶぷぅゅっ', 'えけせてねへめれげぜでべぺぇ', 'おこそとのほもよろをごぞどぼぽぉょ'];
const VOWELS = ['a', 'i', 'u', 'e', 'o'] as const;

function vowelOf(ch: string): string {
  const hira = ch.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  if (hira === 'ん') return 'N';
  for (let i = 0; i < ROWS.length; i += 1) if (ROWS[i]!.includes(hira)) return VOWELS[i]!;
  return VOWELS[ch.charCodeAt(0) % 5]!; // 漢字などは 1 文字 2 モーラ相当として母音を散らす
}

export function fakeQuery(text: string): VoicevoxQuery {
  const phrases: VoicevoxQuery['accent_phrases'] = [];
  let moras: VoicevoxQuery['accent_phrases'][number]['moras'] = [];
  const flush = (pause: boolean) => {
    if (!moras.length) return;
    phrases.push({ moras, pause_mora: pause ? { text: '、', vowel: 'pau', vowel_length: 0.3 } : null, is_interrogative: false });
    moras = [];
  };
  for (const ch of text) {
    if (/[、。！？!?,.\s]/.test(ch)) {
      flush(true);
      continue;
    }
    const kanji = /[一-鿿]/.test(ch);
    for (let k = 0; k < (kanji ? 2 : 1); k += 1) {
      const v = vowelOf(ch);
      moras.push({ text: ch, consonant: v === 'N' ? null : 'k', consonant_length: v === 'N' ? 0 : 0.045, vowel: v, vowel_length: 0.085 });
    }
    if (moras.length >= 9) flush(false);
  }
  flush(false);
  return { accent_phrases: phrases, speedScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.2 };
}

/** 長さぶんの無音 wav (24kHz mono 16bit) を書く。 */
export function fakeSynthesize(cacheDir: string, key: string, text: string, duration: number): Synth {
  mkdirSync(cacheDir, { recursive: true });
  const rate = 24000;
  const n = Math.ceil(duration * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  const wavPath = join(cacheDir, `${key}.fake.wav`);
  writeFileSync(wavPath, buf);
  return { query: fakeQuery(text), wavPath };
}
