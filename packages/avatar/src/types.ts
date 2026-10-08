// 面接官アバターの動き (spec/feature/avatar/interviewer-motion.md) の共通型。
// 時刻はすべて秒、角度は度。描画には依存しない。

/** 口形。VOICEVOX のモーラ母音と閉唇子音から決める。 */
export type Viseme = 'a' | 'i' | 'u' | 'e' | 'o' | 'n' | 'closed';

export type VisemeKey = { t0: number; t1: number; viseme: Viseme };

/** 1 発話。speakerId は面接官 id か CANDIDATE。 */
export type Utterance = {
  speakerId: string;
  start: number;
  end: number;
  text: string;
  visemes: VisemeKey[];
  /** アクセント句の終わり (相づち・うなずきの手がかり)。 */
  phraseEnds: number[];
  /** 文末が問いかけか (眉を上げる)。 */
  question: boolean;
};

export const CANDIDATE = 'candidate';

/** 画面上の並び。index 0 が左。 */
export type PanelMember = { id: string; seat: number; speaks: boolean };

export type Rotation = { rx: number; ry: number; rz: number };

/** 論理名での姿勢。リグ固有の骨名・モーフ名へは RigMap で写す。 */
export type AvatarPose = {
  bones: { chest: Rotation; neck: Rotation; head: Rotation; eyeL: Rotation; eyeR: Rotation };
  morphs: { a: number; i: number; u: number; e: number; o: number; blink: number; browUp: number; smile: number };
};

export type BoneKey = keyof AvatarPose['bones'];
export type MorphKey = keyof AvatarPose['morphs'];

/** 振る舞いが共有する文脈。 */
export type MotionContext = {
  panel: PanelMember[];
  utterances: Utterance[];
  duration: number;
  seed: number;
};
