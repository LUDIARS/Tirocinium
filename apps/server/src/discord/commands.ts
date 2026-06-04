export type DiscordInterviewMode = 'text' | 'voice';

export type DiscordCommand =
  | { kind: 'start'; mode: DiscordInterviewMode; target: string }
  | { kind: 'end' }
  | { kind: 'help' }
  | { kind: 'none' };

export function parseDiscordCommand(content: string, prefix: string): DiscordCommand {
  const trimmed = content.trim();
  if (!trimmed.startsWith(prefix)) return { kind: 'none' };

  const rest = trimmed.slice(prefix.length).trim();
  if (!rest || rest === 'help') return { kind: 'help' };
  if (rest === 'end') return { kind: 'end' };

  const [subcommand, ...targetParts] = rest.split(/\s+/);
  if (subcommand === 'text' || subcommand === 'voice') {
    return {
      kind: 'start',
      mode: subcommand,
      target: targetParts.join(' ').trim(),
    };
  }

  return { kind: 'help' };
}

export function renderDiscordHelp(prefix: string): string {
  return [
    `Tr Discord interview commands:`,
    `- \`${prefix} text [target]\`: start a text interview in this channel.`,
    `- \`${prefix} voice [target]\`: create an MTG voice room and start a Tr-led interview.`,
    `- \`${prefix} end\`: end the active interview for this channel.`,
  ].join('\n');
}
