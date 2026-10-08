import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./routing.js', () => ({
  claimDelivery: vi.fn(), consumePairing: vi.fn(), finishDelivery: vi.fn(), relayDestination: vi.fn(),
}));
import { claimDelivery, consumePairing, finishDelivery, relayDestination } from './routing.js';
import { handleReviewMessage } from './discord-relay.js';

const message = () => ({
  id: 'event-1', channel_id: 'private-student', author: { id: 'student-account' },
  content: '!tr es reply 0123456789abcdef 添削をお願いします。',
});
describe('private ES relay', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(claimDelivery).mockResolvedValue(true);
    vi.mocked(relayDestination).mockResolvedValue({
      requestId: 'internal-request', role: 'student', channelId: 'private-ob', alias: 'fedcba9876543210',
    });
  });
  it('never routes guild messages or attachments', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await handleReviewMessage({ ...message(), guild_id: 'shared' }, '!tr', send);
    await handleReviewMessage({ ...message(), attachments: [{}] }, '!tr', send);
    expect(relayDestination).not.toHaveBeenCalled();
    expect(consumePairing).not.toHaveBeenCalled();
  });
  it('labels the sender by role and uses the recipient alias without account metadata', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await handleReviewMessage(message(), '!tr', send);
    const delivered = send.mock.calls[0]!;
    expect(delivered[0]).toBe('private-ob');
    expect(delivered[1]).toContain('fedcba9876543210');
    expect(delivered[1]).toContain('学生から');
    expect(delivered[1]).not.toContain('student-account');
    expect(delivered[1]).not.toContain('0123456789abcdef');
    expect(finishDelivery).toHaveBeenCalledWith('event-1', 'sent');
  });
  it('rejects an unbound or closed destination before claiming delivery', async () => {
    vi.mocked(relayDestination).mockResolvedValue(null);
    await handleReviewMessage(message(), '!tr', vi.fn().mockResolvedValue(undefined));
    expect(claimDelivery).not.toHaveBeenCalled();
  });
  it('does not resend duplicate gateway events', async () => {
    vi.mocked(claimDelivery).mockResolvedValue(false);
    const send = vi.fn().mockResolvedValue(undefined);
    await handleReviewMessage(message(), '!tr', send);
    expect(send).not.toHaveBeenCalled();
  });
  it('marks uncertain delivery and never echoes raw errors', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('private body')).mockResolvedValue(undefined);
    await handleReviewMessage(message(), '!tr', send);
    expect(finishDelivery).toHaveBeenCalledWith('event-1', 'unknown');
    expect(send.mock.calls[1]![1]).not.toContain('private body');
  });
  it('rejects contact links before looking up a destination', async () => {
    await handleReviewMessage({ ...message(), content: message().content + ' https://discord.gg/example' }, '!tr', vi.fn().mockResolvedValue(undefined));
    expect(relayDestination).not.toHaveBeenCalled();
  });
});
