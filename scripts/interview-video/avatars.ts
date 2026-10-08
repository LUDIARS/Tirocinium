// アバター設定 (JSON): モデルの場所、論理名 → 骨名・モーフ名の対応、カメラ、背景色、声。
// 対応表があれば任意の FBX アバターに差し替えられる (Astra 製のアバターが届いたら JSON だけ替える)。
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { RigMap } from '../../packages/avatar/src/index.js';

export type AvatarConfig = {
  /** シナリオの panel id (field / senior / observer)。 */
  id: string;
  /** Pictor fbx_viewer に渡すモデルのフォルダか .fbx (設定ファイルからの相対パス可)。 */
  model: string;
  rig: RigMap;
  /** モデル空間 (m) のカメラ: 目の位置と注視点。 */
  camera: [number, number, number, number, number, number];
  fov?: number;
  clear: [number, number, number];
  /** VOICEVOX の話者 id。聞き役は話さないので省略可。 */
  voice?: number;
};

export type AvatarSet = { avatars: AvatarConfig[]; candidateVoice: Record<string, number> };

export function loadAvatarSet(path: string): AvatarSet {
  const set = JSON.parse(readFileSync(path, 'utf8')) as AvatarSet;
  for (const a of set.avatars) a.model = resolve(dirname(path), a.model);
  return set;
}
