// 提出資料を受け付けて要点を作り、セッションに結び付ける application use case。
// spec/feature/voice/glab-material-interview.md §2/§3。
// 判定 (material-policy)、スキルの読み込み (consult-skills)、読解 (material-reader)、
// 保持 (material-store) を順に呼ぶだけで、HTTP と DB は呼び出し側が持つ。

import { loadInterviewerSkills, type InterviewerSkills } from './consult-skills.js';
import {
  isMaterialUploadError,
  parseMaterialUpload,
  type MaterialUpload,
  type MaterialUploadError,
} from './material-policy.js';
import { readMaterial } from './material-reader.js';
import { hasMaterialDigest, putMaterialDigest } from './material-store.js';

export type SubmitMaterialResult =
  | { ok: true; kind: 'es' | 'portfolio'; digestChars: number }
  | { ok: false; status: 400 | 409 | 413 | 415 | 503; error: MaterialUploadError | 'material_already_submitted' | 'consult_skills_unavailable' | 'material_read_failed' };

export type SubmitMaterialPorts = {
  loadSkills?: () => Promise<InterviewerSkills>;
  read?: typeof readMaterial;
  log?: (message: string) => void;
};

const ERROR_STATUS: Record<MaterialUploadError, 400 | 413 | 415> = {
  invalid_material_request: 400,
  invalid_material_kind: 400,
  material_empty: 400,
  unsupported_material_type: 415,
  material_too_large: 413,
};

export async function submitMaterial(
  sessionId: string,
  userId: string,
  raw: unknown,
  ports: SubmitMaterialPorts = {},
): Promise<SubmitMaterialResult> {
  const upload = parseMaterialUpload(raw);
  if (isMaterialUploadError(upload)) return { ok: false, status: ERROR_STATUS[upload], error: upload };
  // 1 セッション 1 資料。差し替えは新しいセッションで行う (面接中に要点が変わらないように)。
  if (hasMaterialDigest(sessionId) || reading.has(sessionId)) {
    return { ok: false, status: 409, error: 'material_already_submitted' };
  }
  reading.add(sessionId);
  try {
    return await digestAndStore(sessionId, userId, upload, ports);
  } finally {
    reading.delete(sessionId);
  }
}

/** 読解中のセッション (同じセッションへの同時提出で claude を 2 本起こさない)。 */
const reading = new Set<string>();

async function digestAndStore(
  sessionId: string,
  userId: string,
  upload: MaterialUpload,
  ports: SubmitMaterialPorts,
): Promise<SubmitMaterialResult> {
  const log = ports.log ?? ((message: string) => console.warn(message));
  let skills: InterviewerSkills;
  try {
    skills = await (ports.loadSkills ?? loadInterviewerSkills)();
  } catch (err) {
    log(`[materials] consult skills unavailable: ${(err as Error).message}`);
    return { ok: false, status: 503, error: 'consult_skills_unavailable' };
  }
  let digest: string;
  try {
    digest = await (ports.read ?? readMaterial)(upload, skills.reader);
  } catch (err) {
    // 資料の中身はログに出さない (個人データ)。
    log(`[materials] read failed: ${(err as Error).message}`);
    return { ok: false, status: 503, error: 'material_read_failed' };
  }
  putMaterialDigest(sessionId, userId, { kind: upload.kind, digest, interviewerSkill: skills.interviewer });
  return { ok: true, kind: upload.kind, digestChars: digest.length };
}
