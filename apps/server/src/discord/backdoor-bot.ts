// 裏口 Bot B: 卒業生が Discord から自己投稿エントリを管理する。
// 本体/面接の Bot A (bridge.ts) とは別 token・別 gateway で「別管理」。
// 投稿の本人性は Discord author id をアンカーにし、 裏口 view へは link コマンドの
// マジックリンク (session token) で受け渡す。

import { config } from '../config.js';
import { startGateway, type GatewayMessage, type DiscordRest } from './gateway-client.js';
import { parseBackdoorCommand, renderBackdoorHelp } from './backdoor-commands.js';
import {
  upsertEntry,
  getEntry,
  deleteEntry,
  issueLinkToken,
  type BackdoorEntry,
} from '../companies/backdoor-repo.js';

// GUILDS(1) | GUILD_MESSAGES(512) | MESSAGE_CONTENT(32768)。 音声は使わないので GUILD_VOICE_STATES 不要。
const INTENTS = 1 | 512 | 32768;

function authorName(msg: GatewayMessage): string {
  return (msg.author.global_name || msg.author.username || '').trim();
}

function renderEntry(entry: BackdoorEntry | null): string {
  if (!entry) return '登録はまだありません。 `company` / `students` / `industry` で登録できます。';
  const lines = [
    `表示名: ${entry.display_name || '(未設定)'}`,
    `今いる企業: ${entry.current_company || '(未設定)'}`,
    `学生向け: ${entry.message_to_students ? (entry.students_published ? '掲載中' : '下書き') : '(未設定)'}`,
    `業界向け: ${entry.message_to_industry ? (entry.industry_published ? '掲載中' : '下書き') : '(未設定)'}`,
  ];
  return lines.join('\n');
}

async function handle(msg: GatewayMessage, rest: DiscordRest): Promise<void> {
  if (msg.author.bot) return;
  const cfg = config.discordBackdoor;
  if (cfg.allowedChannelIds.length > 0 && !cfg.allowedChannelIds.includes(msg.channel_id)) {
    return;
  }

  const command = parseBackdoorCommand(msg.content, cfg.commandPrefix);
  if (command.kind === 'none') return;

  const userId = msg.author.id;
  const name = authorName(msg);

  switch (command.kind) {
    case 'help':
    case 'unknown':
      await rest.sendMessage(msg.channel_id, renderBackdoorHelp(cfg.commandPrefix));
      return;
    case 'show': {
      const entry = await getEntry(userId);
      await rest.sendMessage(msg.channel_id, renderEntry(entry));
      return;
    }
    case 'link': {
      const token = await issueLinkToken(userId, name, cfg.linkTtlMin);
      const url = `${cfg.appBaseUrl.replace(/\/$/, '')}/backdoor?token=${token}`;
      try {
        await rest.sendDirectMessage(
          userId,
          [
            'Tirocinium 裏口ページのワンタイムリンクです (このリンクから投稿/編集できます):',
            url,
            `有効期限: ${cfg.linkTtlMin} 分。 リンクは 1 回だけ使えます。`,
          ].join('\n'),
        );
        await rest.sendMessage(msg.channel_id, 'DM にリンクを送りました。 ご確認ください。');
      } catch {
        await rest.sendMessage(
          msg.channel_id,
          'DM を送れませんでした。 サーバー設定で DM を許可してから再度お試しください。',
        );
      }
      return;
    }
    case 'delete':
      await deleteEntry(userId);
      await rest.sendMessage(msg.channel_id, '登録を削除しました。');
      return;
    case 'set-name': {
      await upsertEntry(userId, name, { display_name: command.value });
      await rest.sendMessage(msg.channel_id, `表示名を「${command.value}」に設定しました。`);
      return;
    }
    case 'set-company': {
      await upsertEntry(userId, name, { current_company: command.value });
      await rest.sendMessage(msg.channel_id, `今いる企業を「${command.value}」に登録しました。`);
      return;
    }
    case 'set-students': {
      await upsertEntry(userId, name, { message_to_students: command.value, students_published: true });
      await rest.sendMessage(msg.channel_id, '学生に向けたメッセージを掲載しました。');
      return;
    }
    case 'set-industry': {
      await upsertEntry(userId, name, { message_to_industry: command.value, industry_published: true });
      await rest.sendMessage(msg.channel_id, '業界内に向けたメッセージを掲載しました。');
      return;
    }
    case 'hide': {
      const patch = command.target === 'students'
        ? { students_published: false }
        : { industry_published: false };
      await upsertEntry(userId, name, patch);
      await rest.sendMessage(msg.channel_id, '掲載を取り下げました。');
      return;
    }
  }
}

/** Bot B を起動する。 token 未設定なら no-op (裏口 API/view は Bot 無しでも動く)。 */
export function startBackdoorBot(): () => void {
  const cfg = config.discordBackdoor;
  if (!cfg.botToken) {
    return () => undefined;
  }
  const handle_ = startGateway({
    token: cfg.botToken,
    intents: INTENTS,
    appName: 'tirocinium-backdoor',
    onMessage: handle,
  });
  return handle_.stop;
}
