import { describe, expect, it } from 'vitest';
import { serviceVersion } from './version.js';

describe('serviceVersion', () => {
  it('uses the documented environment-variable precedence', () => {
    expect(serviceVersion({
      EXCUBITOR_SERVICE_VERSION: '1.2.3',
      TIROCINIUM_SERVICE_VERSION: '2.0.0',
      npm_package_version: '3.0.0',
    })).toBe('1.2.3');
    expect(serviceVersion({
      TIROCINIUM_SERVICE_VERSION: '2.0.0',
      npm_package_version: '3.0.0',
    })).toBe('2.0.0');
    expect(serviceVersion({ npm_package_version: '3.0.0' })).toBe('3.0.0');
    expect(serviceVersion({})).toBe('unknown');
  });
});
