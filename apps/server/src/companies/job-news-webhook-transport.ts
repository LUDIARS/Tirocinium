// Discord incoming webhook の送信境界。例外・応答本文へ含まれる秘密を外へ返さない。
export type WebhookResult = 'sent' | 'failed' | 'unknown';

export function validateJobNewsWebhook(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid_job_news_webhook'); }
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port
    || url.username || url.password || url.hash || url.search
    || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)) {
    throw new Error('invalid_job_news_webhook');
  }
  url.searchParams.set('wait', 'true');
  return url.href;
}

export async function sendJobNewsWebhook(
  endpoint: string,
  content: string,
  fetcher: typeof fetch = fetch,
): Promise<WebhookResult> {
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] }, flags: 4 }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    // 4xx は拒否が明確。5xx/通信断は配送済みの可能性があり再送しない。
    const result = response.ok ? 'sent'
      : response.status >= 400 && response.status < 500 ? 'failed' : 'unknown';
    await response.body?.cancel();
    return result;
  } catch {
    // 秘密URLを含みうるfetch例外は、配送結果不明という状態に変換する。
    return 'unknown';
  }
}
