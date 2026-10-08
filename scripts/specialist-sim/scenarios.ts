// 専門面接シミュレーションの架空シナリオ。実在の企業・人物・ES は使わない。
// llm パッケージの index は claude CLI ヘルパー (@ludiars/one-shot) を巻き込むため、個別モジュールから読む
import type { ExamineePersonaInput } from '../../packages/llm/src/types.js';
import type { NewgradFocusInput } from '../../packages/llm/src/specialist-focus.js';
import type { SpecialistInterviewer, SpecialistProfile } from '../../packages/llm/src/specialist-profile.js';

/** パネル面接の面接官 (架空)。interviewer が null の人は聞き役で話さない。 */
export type PanelInterviewer = { id: string; name: string; title: string; interviewer: SpecialistInterviewer | null };

/** 画面の左から順。senior が議長 (あいさつと締め)。 */
export const PANEL: PanelInterviewer[] = [
  { id: 'field', name: '岩田', title: '現場エンジニア (40代)', interviewer: 'field' },
  { id: 'senior', name: '大森', title: 'テックリード (50代)', interviewer: 'senior' },
  { id: 'observer', name: '長谷川', title: 'プロデューサー (聞き役)', interviewer: null },
];

export type SimScenario = {
  id: string;
  title: string;
  profile: SpecialistProfile;
  companyName: string;
  newgrad: NewgradFocusInput;
  /** 受験者の ES (架空)。面接官には「受験者の素材」として渡す。 */
  es: string;
  examinee: ExamineePersonaInput;
  /** 逆質問で聞くこと。面接官の手元の資料に無い社内事情を混ぜる。 */
  reverseQuestions: string[];
  panel: PanelInterviewer[];
};

const COMPANY = '株式会社ルミナスゲームズ (架空)';

const NEWGRAD: NewgradFocusInput = {
  summary: '自分で課題を見つけて手を動かし、チームに説明しながら作品を磨き上げられる新卒を求める。',
  themes: ['自走力', 'チームでの伝達', '遊びへのこだわり'],
};

export const SCENARIOS: Record<string, SimScenario> = {
  designer: {
    id: 'designer',
    title: 'デザイナー職 × 現場エンジニア面接 (1次技術面接)',
    profile: { role: 'designer', level: 'entry', interviewer: 'field' },
    companyName: COMPANY,
    newgrad: NEWGRAD,
    es: [
      '【学生時代に力を入れたこと】チーム制作の 3D アクションゲーム (6 人、Unity) で、キャラクターと UI のデザインを担当した。',
      '主人公のモデリング (Blender、ローポリ約 8,000 ポリゴン) とアニメーション 12 種、HUD とメニュー画面を制作した。',
      '学内プレイテストで「体力ゲージが見づらい」という意見が多く、配色と配置を 3 回作り直した。',
      '【自己 PR】見た目の好みだけでなく、遊ぶ人が迷わないことを基準に判断する。',
    ].join('\n'),
    examinee: {
      display_name: '佐倉ひより (架空の受験者)',
      background: 'ゲーム専門学校 3 年生。3D キャラクターと UI のデザインを学ぶ。チーム制作でキャラと UI を担当。',
      target_role: 'designer',
      weakness_axes: { clarity: 2, depth_resilience: 2 },
      strengths: ['Blender でのローポリモデリング', 'UI の視認性改善', 'プレイテストの意見の取り込み'],
      speech_style: 'formal',
      intentional_flaws: ['数字を聞かれると少し曖昧になる', '性能面の制約は詳しくない'],
      bio: '自己紹介: 佐倉ひよりです。キャラクターと UI のデザインを学んでいて、チーム制作では主人公と HUD を担当しました。遊ぶ人が迷わない画面を作ることを大切にしています。',
    },
    panel: PANEL,
    reverseQuestions: [
      '入社後、新人のデザイナーはどんな研修やレビューを受けて現場に入るのでしょうか。',
      'デザイナーとエンジニアは普段どのくらいの人数のチームで、どう連携していますか。',
    ],
  },
  programmer: {
    id: 'programmer',
    title: 'エンジニア職 × シニア (テックリード) 面接 (2次技術面接)',
    profile: { role: 'programmer', level: 'entry', interviewer: 'senior' },
    companyName: COMPANY,
    newgrad: NEWGRAD,
    es: [
      '【学生時代に力を入れたこと】C++ で 2D 物理エンジンを自作し、チーム制作の横スクロールアクションに組み込んだ。',
      '当たり判定は空間分割 (均一グリッド) で、オブジェクト 2,000 個で 60fps を維持した。最初は総当たりで 18fps だった。',
      'チームではゲームプレイ担当 2 人に向けて API と使い方の資料を書き、週 1 回のレビューを回した。',
      '【自己 PR】遅い・壊れるを計測で確かめてから直す。',
    ].join('\n'),
    examinee: {
      display_name: '高峰そうた (架空の受験者)',
      background: '情報系大学 4 年生。C++ とゲームエンジンの仕組みに関心。物理エンジンを自作しチーム制作で使った。',
      target_role: 'programmer',
      weakness_axes: { self_understanding: 2, target_fit: 2 },
      strengths: ['C++', '空間分割による当たり判定の高速化', 'プロファイラでの計測'],
      speech_style: 'casual',
      intentional_flaws: ['技術の話は詳しいが、なぜこの会社かの説明が弱い', 'チームでの摩擦の話は少し避けがち'],
      bio: '自己紹介: 高峰そうたです。C++ で 2D の物理エンジンを自作して、チームの横スクロールアクションで使いました。遅い所は計測してから直すのが信条です。',
    },
    panel: PANEL,
    reverseQuestions: [
      '御社のタイトルでは、エンジンは内製と市販のどちらを使っていて、新人はどこから触ることが多いですか。',
      'テックリードの方から見て、1 年目で伸びる人と伸び悩む人の違いは何でしょうか。',
    ],
  },
};
