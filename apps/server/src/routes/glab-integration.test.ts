import { describe, expect, it } from 'vitest';
import { glabIntegration } from './glab-integration.js';

const loopbackEnv = {
  incoming: { socket: { remoteAddress: '127.0.0.1' } },
};

describe('GLab internal integration guard', () => {
  it('loopback以外からのCernere IDヘッダーを拒否する', async () => {
    const response = await glabIntegration.request('/career-companies', {
      headers: { 'X-Cernere-User-Id': 'cernere-user-1' },
    }, {
      incoming: { socket: { remoteAddress: '192.0.2.10' } },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'loopback_required' });
  });

  it('loopbackでもCernere IDがなければ拒否する', async () => {
    const response = await glabIntegration.request(
      '/career-companies',
      undefined,
      loopbackEnv,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_cernere_user_id' });
  });
});
