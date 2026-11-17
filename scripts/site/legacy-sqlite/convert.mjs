// SQLite の 1 値を、移し先 Postgres 列の型に合わせた「テキストの引数 + 明示キャスト」に変える。
// Node 版の SQLite ドライバ (apps/server/src/db/sqlite-driver.ts) の書き方に合わせて読む:
//   真偽 = 0/1、配列 (text[]) と JSON = JSON テキスト、日時 = datetime('now') の UTC か ISO 8601。
// 変換できない値は例外にせず { error } を返す (呼び出し側が行と列を一覧にする)。値そのものは返さない。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// datetime('now') = "YYYY-MM-DD HH:MM:SS" (UTC、時差なし)。toISOString() = "...T...Z"。時差つきの ISO も受ける。
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;
const INT4RANGE = /^[[(]\s*(-?\d+)\s*,\s*(-?\d+)\s*[\])]$/;

const INT_RANGES = {
  int2: [-32768n, 32767n],
  int4: [-2147483648n, 2147483647n],
  int8: [-9223372036854775808n, 9223372036854775807n],
};

/** Postgres の udt_name ごとの変換。戻り値は { value: string|null, cast } か { error }。 */
const CONVERTERS = {
  text: (v) => (typeof v === 'string' ? textValue(v) : fail('文字列ではない')),
  varchar: (v) => (typeof v === 'string' ? textValue(v) : fail('文字列ではない')),
  uuid: (v) => (typeof v === 'string' && UUID.test(v) ? ok(v.toLowerCase()) : fail('UUID の形ではない')),
  bool: (v) => {
    const n = typeof v === 'bigint' ? Number(v) : v;
    return n === 0 || n === 1 ? ok(n === 1 ? 'true' : 'false') : fail('真偽 (0/1) ではない');
  },
  int2: (v) => integer(v, 'int2'),
  int4: (v) => integer(v, 'int4'),
  int8: (v) => integer(v, 'int8'),
  float8: (v) => real(v),
  float4: (v) => real(v),
  timestamptz: (v) => timestamp(v),
  jsonb: (v) => json(v),
  json: (v) => json(v),
  _text: (v) => textArray(v),
  int4range: (v) => {
    if (typeof v !== 'string') return fail('範囲の文字列ではない');
    const m = INT4RANGE.exec(v.trim());
    if (!m) return fail('int4range の形ではない');
    for (const part of [m[1], m[2]]) {
      const n = BigInt(part);
      if (n < INT_RANGES.int4[0] || n > INT_RANGES.int4[1]) return fail('int4range の端が int4 を超える');
    }
    return ok(v.trim());
  },
};

function ok(value) {
  return { value };
}

function fail(reason) {
  return { error: reason };
}

function textValue(s) {
  return s.includes('\u0000') ? fail('NUL 文字を含む (Postgres の text に入らない)') : ok(s);
}

function integer(v, type) {
  let n;
  if (typeof v === 'bigint') n = v;
  else if (typeof v === 'number' && Number.isInteger(v)) n = BigInt(v);
  else return fail('整数ではない');
  const [lo, hi] = INT_RANGES[type];
  return n < lo || n > hi ? fail(`${type} の範囲を超える`) : ok(n.toString());
}

function real(v) {
  const n = typeof v === 'bigint' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? ok(String(n)) : fail('有限の数ではない');
}

function timestamp(v) {
  if (typeof v !== 'string') return fail('日時の文字列ではない');
  const m = TIMESTAMP.exec(v.trim());
  if (!m) return fail('日時の形ではない');
  const [, y, mo, d, h, mi, s, frac = '', zone] = m;
  const probe = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== Number(d)) return fail('存在しない日時');
  // 時差の無い値は SQLite の datetime('now') と同じ UTC とみなす。
  const z = zone ?? 'Z';
  return ok(`${y}-${mo}-${d}T${h}:${mi}:${s}${frac}${z === 'Z' ? '+00:00' : z}`);
}

function json(v) {
  if (typeof v !== 'string') return fail('JSON の文字列ではない');
  try {
    JSON.parse(v);
  } catch {
    return fail('JSON として読めない');
  }
  // jsonb は文字列中の \u0000 を受けない。
  return /\\u0000/i.test(v) ? fail('JSON に \\u0000 を含む (jsonb に入らない)') : ok(v);
}

function textArray(v) {
  if (typeof v !== 'string') return fail('配列の JSON 文字列ではない');
  let arr;
  try {
    arr = JSON.parse(v);
  } catch {
    return fail('配列の JSON として読めない');
  }
  if (!Array.isArray(arr)) return fail('JSON が配列ではない');
  if (!arr.every((x) => typeof x === 'string')) return fail('配列の要素が文字列ではない');
  if (arr.some((x) => x.includes('\u0000'))) return fail('配列の要素に NUL 文字を含む');
  return ok(`{${arr.map((x) => `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`);
}

/** この型を変換できるか (計画の段階で、対応の無い型を止めるため)。 */
export function isSupportedType(udtName) {
  return Object.hasOwn(CONVERTERS, udtName);
}

/**
 * 1 値を変換する。column = { udtName, nullable }。
 * NULL は列が NULL を許すときだけ通す (既定値は入れない: 元の NULL を勝手に別の値へ変えない)。
 */
export function convertValue(raw, column) {
  if (raw === null || raw === undefined) {
    return column.nullable ? ok(null) : fail('NULL を許さない列に NULL');
  }
  if (raw instanceof Uint8Array) return fail('バイナリ値 (対応する列が無い)');
  const convert = CONVERTERS[column.udtName];
  if (!convert) return fail(`対応の無い型 ${column.udtName}`);
  return convert(raw);
}

/** INSERT の引数に付ける明示キャスト (text の引数を列の型へ)。 */
export function castFor(udtName) {
  return udtName === '_text' ? 'text[]' : udtName;
}
