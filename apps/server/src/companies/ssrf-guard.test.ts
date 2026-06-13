import { describe, it, expect } from 'vitest';
import { assertPublicUrl } from './ssrf-guard.js';

// リテラル IP / プロトコル検査は DNS を引かず決定的なので CI で安定する。
// ホスト名解決経路 (lookup) は環境依存のためここでは検証しない。

describe('assertPublicUrl', () => {
  const blockedV4 = [
    'http://127.0.0.1/x',
    'http://127.1.2.3/x',
    'http://10.0.0.5/x',
    'http://172.16.5.5/x',
    'http://172.31.255.255/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data', // クラウド metadata
    'http://100.64.0.1/x', // CGNAT
    'http://0.0.0.0/x',
    'http://224.0.0.1/x', // multicast
    'http://255.255.255.255/x',
  ];
  for (const url of blockedV4) {
    it(`blocks private/reserved v4: ${url}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  }

  const blockedV6 = [
    'http://[::1]/x', // loopback
    'http://[::]/x', // unspecified
    'http://[fd00::1]/x', // ULA
    'http://[fe80::1]/x', // link-local
    'http://[ff02::1]/x', // multicast
    'http://[::ffff:127.0.0.1]/x', // IPv4-mapped loopback
  ];
  for (const url of blockedV6) {
    it(`blocks private/reserved v6: ${url}`, async () => {
      await expect(assertPublicUrl(url)).rejects.toThrow();
    });
  }

  it('blocks non-http(s) protocols', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow();
    await expect(assertPublicUrl('gopher://127.0.0.1/x')).rejects.toThrow();
  });

  it('rejects malformed urls', async () => {
    await expect(assertPublicUrl('not a url')).rejects.toThrow();
  });

  it('allows public literal IPs', async () => {
    await expect(assertPublicUrl('http://8.8.8.8/x')).resolves.toBeUndefined();
    await expect(assertPublicUrl('https://1.1.1.1/')).resolves.toBeUndefined();
  });
});
