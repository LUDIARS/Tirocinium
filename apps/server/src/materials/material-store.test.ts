import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { clearMaterialDigest, getMaterialDigest, hasMaterialDigest, putMaterialDigest } from './material-store.js';

const value = { kind: 'es' as const, digest: '## 資料の種類\nES', interviewerSkill: 'skill' };

describe('material digest store', () => {
  it('returns the digest only to the session owner', () => {
    putMaterialDigest('store-owner', 'owner', value);
    assert.deepEqual(getMaterialDigest('store-owner', 'owner'), value);
    assert.equal(getMaterialDigest('store-owner', 'someone-else'), null);
    clearMaterialDigest('store-owner');
  });
  it('drops the digest on clear and after the TTL', () => {
    putMaterialDigest('store-clear', 'owner', value);
    clearMaterialDigest('store-clear');
    assert.equal(hasMaterialDigest('store-clear'), false);
    putMaterialDigest('store-ttl', 'owner', value, 0);
    assert.equal(getMaterialDigest('store-ttl', 'owner', 46 * 60_000), null);
    assert.equal(hasMaterialDigest('store-ttl'), false);
  });
});
