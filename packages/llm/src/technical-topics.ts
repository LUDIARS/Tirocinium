import type { CanonicalRole } from './role-aliases.js';
import type { Rng } from './rng.js';
import type { QuestionCandidate } from './question-plan.js';

export type ExperienceLevel = 'entry' | 'experienced';
const TOPICS: Record<CanonicalRole, readonly string[]> = {
  programmer: ['データ構造と計算量', 'メモリと所有権', '状態遷移とテスト', '通信遅延と整合性', 'CPU/GPU/GCの計測', '並行処理とキャンセル'],
  planner: ['ルールと体験の整合', '難易度とプレイテスト', '経済バランス', '仕様の境界条件', '指標と仮説検証', '変更管理と優先順位'],
  designer: ['視認性とアクセシビリティ', 'アセットの性能予算', '制作工程とレビュー', 'UI状態と遷移', 'モーションの伝達性', 'データ管理と再利用'],
  sound: ['音量と聴きやすさ', '音声資源とメモリ', 'インタラクティブ音響', '同期と遅延', 'ミックスの検証', 'アセットと実装境界'],
  general: ['課題の分解', '仮説と検証', '品質と制約', '再現性と記録', 'チーム内の仕様共有', '優先順位の判断'],
};

/** Seen IDs are newest-first. Topic selection is deterministic; the interviewer expands it. */
export function selectTechnicalTopic(role: CanonicalRole, level: ExperienceLevel, seen: string[], rng: Rng): QuestionCandidate {
  const all = TOPICS[role].map((topic, index) => ({ id: `${role}:${index}`, topic }));
  // Keep recent exclusions until at least one option remains. This avoids an
  // immediate repeat while allowing a finite catalog to rotate across sessions.
  let exclusions = [...seen];
  let choices = all.filter(t => !exclusions.includes(t.id));
  while (!choices.length && exclusions.length) {
    exclusions.pop(); choices = all.filter(t => !exclusions.includes(t.id));
  }
  const random = rng();
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('invalid_topic_rng');
  const selected = choices[Math.floor(random * choices.length)]!;
  return { theme: `技術ランダム: ${selected.topic}`, origin: 'seed', followups: [], axes: ['clarity', 'depth_resilience'],
    required: 'random-technical', topicId: selected.id,
    selectionReason: `${role}/${level}; portfolio-independent; seeded RNG; recent topic exclusion`,
    question: `${selected.topic}について、${level === 'entry' ? '基礎と小さな具体例で説明できる' : '設計の代替案・制約・運用を比較できる'}技術質問を一つ選んで具体化してください。本人がその実装を経験したと決めつけず、必要なら仮定の設計問題にしてください。` };
}
