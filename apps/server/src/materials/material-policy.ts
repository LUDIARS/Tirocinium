// 提出資料 (ES / ポートフォリオ) の受付判定。spec/feature/voice/glab-material-interview.md §2。
// 純関数のみ — 保存も読解もしない。個人データ境界 (CLAUDE.md) により、ここを通った資料は
// 一時フォルダで読んだらすぐ消し、DB へは書かない (material-reader.ts / material-store.ts)。

export type MaterialKind = 'es' | 'portfolio';

/** GLab からの転送量を抑える上限 (AWS のエグレス。neco 2026-10-26「あまり大きいデータを送らない」)。 */
export const MAX_MATERIAL_BYTES = 5 * 1024 * 1024;

/** 受け付ける形式と、一時フォルダに置くときの拡張子。 */
const ALLOWED_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export type MaterialUpload = {
  kind: MaterialKind;
  mime: string;
  extension: string;
  bytes: Buffer;
};

export type MaterialUploadError =
  | 'invalid_material_request'
  | 'invalid_material_kind'
  | 'unsupported_material_type'
  | 'material_empty'
  | 'material_too_large';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** 本文 `{ kind, mime, data_base64 }` を検証する。ファイル名は受け取らない (一時フォルダの名前は固定)。 */
export function parseMaterialUpload(raw: unknown): MaterialUpload | MaterialUploadError {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'invalid_material_request';
  const body = raw as { kind?: unknown; mime?: unknown; data_base64?: unknown };
  if (body.kind !== 'es' && body.kind !== 'portfolio') return 'invalid_material_kind';
  if (typeof body.mime !== 'string') return 'invalid_material_request';
  const mime = body.mime.trim().toLowerCase();
  const extension = ALLOWED_MIME[mime];
  if (!extension) return 'unsupported_material_type';
  if (typeof body.data_base64 !== 'string') return 'invalid_material_request';
  const data = body.data_base64.replace(/\s+/g, '');
  if (!data) return 'material_empty';
  // base64 は 4 文字で 3 バイト。デコード前に大きさを弾く。
  if (Math.floor((data.length * 3) / 4) > MAX_MATERIAL_BYTES + 2) return 'material_too_large';
  if (!BASE64.test(data)) return 'invalid_material_request';
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) return 'material_empty';
  if (bytes.length > MAX_MATERIAL_BYTES) return 'material_too_large';
  return { kind: body.kind, mime, extension, bytes };
}

export function isMaterialUploadError(v: MaterialUpload | MaterialUploadError): v is MaterialUploadError {
  return typeof v === 'string';
}
