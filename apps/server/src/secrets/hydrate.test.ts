import { describe, it, expect } from 'vitest';
import { applyDiscordSecrets } from './apply.js';

type Discord = {
  botToken: string;
  guildId: string;
  categoryId: string;
  allowedChannelIds: string[];
  commandPrefix: string;
};

function discord(): Discord {
  return { botToken: '', guildId: '', categoryId: '', allowedChannelIds: [], commandPrefix: '!tr' };
}

describe('applyDiscordSecrets', () => {
  it('applies non-empty secrets to config.discord', () => {
    const d = discord();
    const applied = applyDiscordSecrets(d, {
      TIROCINIUM_DISCORD_BOT_TOKEN: 'bot_xyz',
      TIROCINIUM_DISCORD_GUILD_ID: 'g1',
      TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS: 'c1, c2 , c3',
      TIROCINIUM_DISCORD_COMMAND_PREFIX: '!iv',
    });
    expect(d.botToken).toBe('bot_xyz');
    expect(d.guildId).toBe('g1');
    expect(d.allowedChannelIds).toEqual(['c1', 'c2', 'c3']);
    expect(d.commandPrefix).toBe('!iv');
    expect(applied).toContain('TIROCINIUM_DISCORD_BOT_TOKEN');
  });

  it('leaves existing values when secrets are absent/empty', () => {
    const d = discord();
    d.botToken = 'from_env';
    const applied = applyDiscordSecrets(d, { TIROCINIUM_DISCORD_BOT_TOKEN: '' });
    expect(d.botToken).toBe('from_env'); // 空は上書きしない
    expect(d.commandPrefix).toBe('!tr');
    expect(applied).toEqual([]);
  });
});
