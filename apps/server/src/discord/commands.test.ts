import { describe, expect, it } from 'vitest';
import { parseDiscordCommand } from './commands.js';

describe('parseDiscordCommand', () => {
  it('parses text start command', () => {
    expect(parseDiscordCommand('!tr text backend engineer', '!tr')).toEqual({
      kind: 'start',
      mode: 'text',
      target: 'backend engineer',
    });
  });

  it('parses voice start command', () => {
    expect(parseDiscordCommand('!tr voice game company', '!tr')).toEqual({
      kind: 'start',
      mode: 'voice',
      target: 'game company',
    });
  });

  it('parses end command', () => {
    expect(parseDiscordCommand('!tr end', '!tr')).toEqual({ kind: 'end' });
  });

  it('ignores unrelated messages', () => {
    expect(parseDiscordCommand('hello', '!tr')).toEqual({ kind: 'none' });
  });
});
