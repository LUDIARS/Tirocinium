import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { issueCallTicket, consumeCallTicket } from './call-tickets.js';

describe('browser call capabilities', () => {
  it('binds the authenticated owner and consumes once', () => {
    const ticket = issueCallTicket('owned-session', 'owner');
    assert.equal(consumeCallTicket(ticket, 'owned-session'), 'owner');
    assert.equal(consumeCallTicket(ticket, 'owned-session'), null);
  });
  it('rejects use against another session and burns the capability', () => {
    const ticket = issueCallTicket('session-a', 'owner');
    assert.equal(consumeCallTicket(ticket, 'session-b'), null);
    assert.equal(consumeCallTicket(ticket, 'session-a'), null);
  });
  it('revokes an earlier unconsumed connection when reissuing', () => {
    const old = issueCallTicket('reissued', 'owner');
    const current = issueCallTicket('reissued', 'owner');
    assert.equal(consumeCallTicket(old, 'reissued'), null);
    assert.equal(consumeCallTicket(current, 'reissued'), 'owner');
  });
});
