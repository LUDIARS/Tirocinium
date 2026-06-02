// 想定質問の「テーマ土台」。定番の観点 (創作性の低い一般的テーマ) のみを持ち、
// 特定サイトの文面・回答例は一切含まない (合法に合成生成するための種)。
// 実際の質問文・深掘り・模範解答骨子は LLM が生成する (gen-qa-seed/index.ts)。

export type Stage = 'hr' | 'peer-tech' | 'lead-tech' | 'final';
export type Role = 'planner' | 'programmer' | 'designer' | 'sound';

export const STAGES: Stage[] = ['hr', 'peer-tech', 'lead-tech', 'final'];
export const ROLES: Role[] = ['planner', 'programmer', 'designer', 'sound'];

export const STAGE_LABEL: Record<Stage, string> = {
  hr: '人事 (1 次)',
  'peer-tech': '現場 (技術者面接)',
  'lead-tech': 'リード/部長 (2 次技術者面接)',
  final: '役員/最終',
};

export const ROLE_LABEL: Record<Role, string> = {
  planner: 'ゲームプランナー',
  programmer: 'ゲームプログラマ',
  designer: 'ゲームデザイナー/アーティスト',
  sound: 'サウンドクリエイター',
};

/** stage ごとの定番質問テーマ (観点のみ)。 */
export const STAGE_THEMES: Record<Stage, string[]> = {
  hr: [
    '自己紹介',
    '志望動機',
    '学生時代に力を入れたこと',
    '強み',
    '弱み・短所',
    '学業 / 専門領域',
    'チームでの役割',
    '困難をどう乗り越えたか',
    '5 年後のキャリア像',
    '自己 PR',
  ],
  'peer-tech': [
    '直近プロジェクトの概要',
    'あなたが担った範囲',
    '技術 / 手法の選定理由',
    'つまづきと解決',
    'チーム連携の工夫',
    '制作物のこだわり',
  ],
  'lead-tech': [
    '3-5 年単位の仕事観',
    '専門性の深さ',
    '設計 / 判断の軸',
    '失敗からの学び',
    '後輩育成・影響力',
    'トレードオフの判断',
  ],
  final: [
    '人生におけるその仕事の位置づけ',
    '志望度・本気度',
    '長期ビジョン',
    '大事にしている価値観',
    'カルチャーフィット',
    '逆質問',
  ],
};

/** 職種レンズ (質問題材の絞り込み)。 */
export const ROLE_LENS: Record<Role, string> = {
  planner: '仕様 / 体験設計・ユーザー価値の言語化',
  programmer: '技術選定・実装品質・問題解決',
  designer: 'ビジュアル / 表現意図・ポートフォリオ',
  sound: '音作りの意図・制作フロー・実装連携',
};
