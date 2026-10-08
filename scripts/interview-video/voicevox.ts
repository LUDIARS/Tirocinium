// VOICEVOX で 1 発話を合成する。audio_query (口パクの正本) と wav をキャッシュし、切断は数回だけ再試行する。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VoicevoxQuery } from '../../packages/avatar/src/index.js';

export type Synth = { query: VoicevoxQuery; wavPath: string };

export async function synthesize(baseUrl: string, cacheDir: string, key: string, text: string, speaker: number): Promise<Synth> {
  mkdirSync(cacheDir, { recursive: true });
  const wavPath = join(cacheDir, `${key}.wav`);
  const queryPath = join(cacheDir, `${key}.query.json`);
  if (existsSync(wavPath) && existsSync(queryPath)) {
    return { query: JSON.parse(readFileSync(queryPath, 'utf8')) as VoicevoxQuery, wavPath };
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      const q = await fetch(`${baseUrl}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`, { method: 'POST' });
      if (!q.ok) throw new Error(`audio_query ${q.status}`);
      const query = (await q.json()) as VoicevoxQuery;
      query.speedScale = 1.08;
      query.postPhonemeLength = 0.2;
      const s = await fetch(`${baseUrl}/synthesis?speaker=${speaker}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
      });
      if (!s.ok) throw new Error(`synthesis ${s.status}`);
      writeFileSync(wavPath, Buffer.from(await s.arrayBuffer()));
      writeFileSync(queryPath, JSON.stringify(query), 'utf8');
      return { query, wavPath };
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}
