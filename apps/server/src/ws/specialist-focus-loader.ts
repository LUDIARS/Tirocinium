// 専門面接の「聞きたい要点」を接続ごとに用意する。spec/feature/inference/specialist-interviews.md
// 要点は受験者の ES (Memoria RAG 抜粋) に由来するため DB へ保存しない。再接続時は作り直す。
// 面接開始を待たせないよう、既定の要点を先に渡してから LLM の要点で差し替える。

import {
  fallbackFocusPoints,
  renderFocusBlock,
  type InterviewerBrain,
  type NewgradFocusInput,
  type SpecialistProfile,
} from '@tirocinium/llm';
import { getNewgradImage, resolveCompany } from '../brief/sources.js';

export type SpecialistFocusInput = {
  brain: InterviewerBrain;
  profile: SpecialistProfile;
  targetCompany: string | null;
  /** Memoria RAG 抜粋。取得できなかった接続では空。 */
  materials: string;
  /** 要点ブロックが用意できるたびに呼ぶ (既定 → 企業の新卒像込み → LLM の順)。 */
  onReady: (focusBlock: string) => void;
};

async function loadNewgrad(targetCompany: string | null, profile: SpecialistProfile): Promise<NewgradFocusInput | null> {
  const company = await resolveCompany(targetCompany);
  return company ? getNewgradImage(company.id, profile.role) : null;
}

export async function prepareSpecialistFocus(input: SpecialistFocusInput): Promise<void> {
  const { brain, profile, onReady } = input;
  onReady(renderFocusBlock(fallbackFocusPoints(profile, null), profile));

  let newgrad: NewgradFocusInput | null = null;
  try {
    newgrad = await loadNewgrad(input.targetCompany, profile);
    if (newgrad) onReady(renderFocusBlock(fallbackFocusPoints(profile, newgrad), profile));
  } catch (err) {
    console.warn('[ws] specialist focus newgrad lookup failed', (err as Error).message);
  }

  try {
    const points = await brain.listFocusPoints({ profile, newgrad, materials: input.materials });
    if (points) onReady(renderFocusBlock(points, profile));
  } catch (err) {
    // 生成失敗は既定の要点のまま面接を続ける (面接進行を優先する縮退)。
    console.warn('[ws] specialist focus generation failed', (err as Error).message);
  }
}
