import { config } from '../config.js';

export type NuntiusPushInput = {
  user_id: string;
  title: string;
  body: string;
  /** 任意の追加情報 */
  data?: Record<string, unknown>;
};

/** Nuntius (Nt) への push 通知 stub。 URL 未設定なら no-op。 */
export async function pushNotification(input: NuntiusPushInput): Promise<{ ok: boolean; reason?: string }> {
  if (!config.nuntiusUrl) {
    return { ok: false, reason: 'nuntius_url_unset' };
  }
  try {
    const res = await fetch(config.nuntiusUrl + '/api/notifications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.nuntiusApiKey ? { authorization: `Bearer ${config.nuntiusApiKey}` } : {}),
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
