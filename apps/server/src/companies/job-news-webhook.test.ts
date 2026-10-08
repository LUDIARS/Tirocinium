import { describe, expect, it, vi } from 'vitest';
import { newsDayAt } from './job-news-schedule.js';
import { internshipMessage, isInternshipPosting } from './internship-message.js';
import { sendJobNewsWebhook, validateJobNewsWebhook } from './job-news-webhook-transport.js';
import type { StoredJobPosting } from './job-postings-repo.js';

const posting: StoredJobPosting = {
  id: '1', source: 'gamemakers-rss', kind: 'rss', url: 'https://example.com/intern',
  title: '@everyone プログラマーのインターン募集', company_name: '企業', company_id: null,
  role: 'プログラマー', location: '', employment_type: '', snippet: '', posted_at: '', deadline: '', first_seen_at: '',
};

describe('internship news safety boundaries', () => {
  it('uses the configured day and allows one catch-up after the scheduled hour', () => {
    expect(newsDayAt(new Date('2026-10-08T20:59:00Z'), 6, 'Asia/Tokyo')).toBeNull();
    expect(newsDayAt(new Date('2026-10-08T21:00:00Z'), 6, 'Asia/Tokyo')).toBe('Asia/Tokyo:2026-10-09');
    expect(newsDayAt(new Date('2026-10-09T10:00:00Z'), 6, 'Asia/Tokyo')).toBe('Asia/Tokyo:2026-10-09');
    expect(() => newsDayAt(new Date(), 24, 'Asia/Tokyo')).toThrow();
    expect(() => newsDayAt(new Date(), 6, 'not-a-zone')).toThrow();
  });

  it('limits public metadata, strips mention markup, and rejects unsafe links', () => {
    expect(isInternshipPosting(posting)).toBe(true);
    expect(isInternshipPosting({ ...posting, title: '新卒採用を開始' })).toBe(false);
    expect(isInternshipPosting({ ...posting, deadline: '2026-10-08' }, new Date('2026-10-08T15:00:00Z'))).toBe(false);
    const content = internshipMessage({ ...posting, title: posting.title.repeat(100), snippet: '全文を転載しない' });
    expect(content.length).toBeLessThan(2000);
    expect(content).not.toContain('@everyone');
    expect(content).not.toContain('全文を転載しない');
    expect(() => internshipMessage({ ...posting, url: 'javascript:alert(1)' })).toThrow('invalid_posting_url');
  });

  it('allows only a Discord webhook and never puts a bad secret in an error', () => {
    expect(validateJobNewsWebhook('https://discord.com/api/webhooks/123/token')).toContain('?wait=true');
    for (const url of ['https://example.com/api/webhooks/123/token', 'http://discord.com/api/webhooks/123/token',
      'https://discord.com.evil.test/api/webhooks/123/token', 'https://discord.com/api/webhooks/123/token?redirect=x']) {
      expect(() => validateJobNewsWebhook(url)).toThrow('invalid_job_news_webhook');
    }
  });

  it('distinguishes explicit rejection from uncertain delivery without retrying', async () => {
    for (const [status, outcome] of [[200, 'sent'], [429, 'failed'], [500, 'unknown']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      expect(await sendJobNewsWebhook('https://discord.com/api/webhooks/123/token', 'hello', fetcher)).toBe(outcome);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const options = fetcher.mock.calls[0]![1]!;
      expect(JSON.parse(String(options.body)).allowed_mentions.parse).toEqual([]);
      expect(options.redirect).toBe('error');
    }
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-bearing network error'));
    expect(await sendJobNewsWebhook('secret', 'hello', fetcher)).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
