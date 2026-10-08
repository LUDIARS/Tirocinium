// spec/feature/inference/specialist-interviews.md
import type { CanonicalRole } from './role-aliases.js';
import type { InterviewerPersonaInput } from './types.js';

export type SpecialistRole = Exclude<CanonicalRole, 'general'>;
export type SpecialistProfile = { role: SpecialistRole; level: 'entry' | 'experienced' };

export const SPECIALIST_ROLES: Record<SpecialistRole, { label: string; topics: string; criteria: string }> = {
  planner: {
    label: 'プランナー',
    topics: '遊びの目的、ルール設計、レベル設計、難易度と経済バランス、仕様の伝達、プレイテスト',
    criteria: '狙う体験と仕様の整合、仮説の根拠、指標と観察による検証、制作制約との折り合い',
  },
  programmer: {
    label: 'プログラマー',
    topics: 'データ構造、アルゴリズム、設計、メモリと並行処理、性能計測、不具合の切り分け、テスト',
    criteria: '正確性、計算量と資源の説明、責務分割、再現と計測、境界条件と検証方法',
  },
  designer: {
    label: 'デザイナー',
    topics: '造形と視認性、2D・3D・UIの制作工程、アニメーション、実装制約、アセット最適化、レビュー',
    criteria: '表現意図と利用場面の整合、制作工程の説明、可読性、性能予算、修正と品質確認',
  },
  sound: {
    label: 'サウンド',
    topics: '音楽・効果音の設計、録音と編集、ミックス、インタラクティブ音響、実装、音声資源管理',
    criteria: '音の役割と演出意図、聴きやすさ、遷移と同期、音量と資源の制約、実機での検証',
  },
};

/** 未指定は通常面接。不正な明示設定は通常面接へ黙って戻さない。 */
export function parseSpecialistProfile(value: unknown): SpecialistProfile | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_specialist_interview');
  const v = value as Record<string, unknown>;
  if (typeof v.role !== 'string' || !Object.hasOwn(SPECIALIST_ROLES, v.role)
    || (v.level !== 'entry' && v.level !== 'experienced')) throw new Error('invalid_specialist_interview');
  return { role: v.role as SpecialistRole, level: v.level };
}

/** PG JSONB / SQLite TEXT の双方から、保存時と同じ検証で復元する。 */
export function specialistFromMetadata(metadata: unknown): SpecialistProfile | undefined {
  const value: unknown = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return parseSpecialistProfile((value as Record<string, unknown>).specialist_interview);
}

/** 専門モードは固定の現場面接官を使い、人事ペルソナ等との矛盾を防ぐ。 */
export function specialistPersona(profile: SpecialistProfile): InterviewerPersonaInput {
  return {
    display_name: `${SPECIALIST_ROLES[profile.role].label}専門面接官`,
    stage: profile.level === 'entry' ? 'peer-tech' : 'lead-tech',
    role_lens: profile.role,
    temperament: '穏やかで具体的。根拠と検証方法を確認する',
    pressure: 3,
    tics: [],
    bio: '専門職の模擬面接を担当する仮想面接官。実在企業の採用担当者ではない。',
    evaluation_bias: {},
  };
}
