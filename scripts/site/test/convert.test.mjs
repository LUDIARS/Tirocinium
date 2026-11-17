// convert.mjs の境界のテスト (DB 不要)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertValue } from '../legacy-sqlite/convert.mjs';

const col = (udtName, nullable = false) => ({ udtName, nullable });
const value = (raw, c) => {
  const r = convertValue(raw, c);
  assert.equal(r.error, undefined, r.error);
  return r.value;
};
const error = (raw, c) => convertValue(raw, c).error;

test('真偽は 0/1 だけ', () => {
  assert.equal(value(1n, col('bool')), 'true');
  assert.equal(value(0, col('bool')), 'false');
  assert.ok(error(2n, col('bool')));
  assert.ok(error('1', col('bool')));
});

test('整数は型の範囲で止める', () => {
  assert.equal(value(2147483647n, col('int4')), '2147483647');
  assert.ok(error(2147483648n, col('int4')));
  assert.equal(value(-32768n, col('int2')), '-32768');
  assert.ok(error(32768n, col('int2')));
  assert.equal(value(9223372036854775807n, col('int8')), '9223372036854775807');
  assert.ok(error(1.5, col('int4')));
});

test('日時: 時差なしは UTC、ISO はそのまま、壊れた日付は止める', () => {
  assert.equal(value('2026-06-14 13:58:00', col('timestamptz')), '2026-06-14T13:58:00+00:00');
  assert.equal(value('2026-06-14T13:58:00.5Z', col('timestamptz')), '2026-06-14T13:58:00.5+00:00');
  assert.equal(value('2026-06-14T22:58:00+09:00', col('timestamptz')), '2026-06-14T22:58:00+09:00');
  assert.ok(error('2026-02-30 00:00:00', col('timestamptz')));
  assert.ok(error('2026-06-14', col('timestamptz')));
  assert.ok(error(1718373480n, col('timestamptz')));
});

test('JSON と配列', () => {
  assert.equal(value('{"a":[1]}', col('jsonb')), '{"a":[1]}');
  assert.ok(error('{a:1}', col('jsonb')));
  assert.ok(error('"\\u0000"', col('jsonb')));
  assert.equal(value('["a","b\\"c","d\\\\e"]', col('_text')), '{"a","b\\"c","d\\\\e"}');
  assert.equal(value('[]', col('_text')), '{}');
  assert.ok(error('[1]', col('_text')));
  assert.ok(error('{"a":1}', col('_text')));
});

test('uuid / int4range / text / NULL', () => {
  assert.equal(value('AAAAAAAA-1111-4111-8111-111111111111', col('uuid')), 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.ok(error('abc', col('uuid')));
  assert.equal(value('[1,3]', col('int4range')), '[1,3]');
  assert.ok(error('[1,2147483648]', col('int4range')));
  assert.ok(error('1-3', col('int4range')));
  assert.ok(error('a\u0000b', col('text')));
  assert.ok(error(5n, col('text')));
  assert.equal(value(null, col('text', true)), null);
  assert.ok(error(null, col('text')));
  assert.ok(error(new Uint8Array([1]), col('text', true)));
  assert.ok(error('x', col('tsvector')));
});
