import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { MAX_MATERIAL_BYTES, parseMaterialUpload } from './material-policy.js';

const b64 = (text: string) => Buffer.from(text).toString('base64');

describe('submitted material policy', () => {
  it('accepts an ES as plain text and fixes the temp extension from the mime type', () => {
    const result = parseMaterialUpload({ kind: 'es', mime: 'Text/Plain', data_base64: b64('志望動機') });
    assert.ok(typeof result !== 'string');
    assert.equal(result.kind, 'es');
    assert.equal(result.extension, 'txt');
    assert.equal(result.bytes.toString('utf8'), '志望動機');
  });
  it('accepts a portfolio PDF and images', () => {
    for (const [mime, ext] of [['application/pdf', 'pdf'], ['image/png', 'png'], ['image/jpeg', 'jpg']] as const) {
      const result = parseMaterialUpload({ kind: 'portfolio', mime, data_base64: b64('x') });
      assert.ok(typeof result !== 'string');
      assert.equal(result.extension, ext);
    }
  });
  it('rejects unknown kinds, unsupported types and malformed bodies', () => {
    assert.equal(parseMaterialUpload(null), 'invalid_material_request');
    assert.equal(parseMaterialUpload([]), 'invalid_material_request');
    assert.equal(parseMaterialUpload({ kind: 'resume', mime: 'text/plain', data_base64: b64('x') }), 'invalid_material_kind');
    assert.equal(parseMaterialUpload({ kind: 'es', mime: 'application/zip', data_base64: b64('x') }), 'unsupported_material_type');
    assert.equal(parseMaterialUpload({ kind: 'es', mime: 'text/plain', data_base64: '' }), 'material_empty');
    assert.equal(parseMaterialUpload({ kind: 'es', mime: 'text/plain', data_base64: 'not base64!' }), 'invalid_material_request');
  });
  it('rejects material over the transfer cap before decoding', () => {
    const big = 'A'.repeat(Math.ceil(((MAX_MATERIAL_BYTES + 1024) * 4) / 3));
    assert.equal(parseMaterialUpload({ kind: 'portfolio', mime: 'application/pdf', data_base64: big }), 'material_too_large');
  });
});
