import { describe, expect, it } from 'vitest';
import { allowedHostsFromEnv, parseAllowedHosts } from './allowed-hosts';

describe('vite allowed hosts', () => {
  it('reads the Excubitor-injected LUDIARS_ALLOWED_HOSTS and the per-site VITE_ALLOWED_HOSTS', () => {
    expect(allowedHostsFromEnv({ LUDIARS_ALLOWED_HOSTS: '.Example.test', VITE_ALLOWED_HOSTS: 'tr.other.test, localhost' }))
      .toEqual(['localhost', '127.0.0.1', '.example.test', 'tr.other.test']);
    expect(allowedHostsFromEnv({})).toEqual(['localhost', '127.0.0.1']);
  });

  it('rejects URLs, userinfo, ports and wildcards instead of widening the Host check', () => {
    expect(parseAllowedHosts('https://a.test, user@a.test, a.test:443, *, *.a.test, a..test, -a.test, ok.test')).toEqual(['ok.test']);
  });
});
