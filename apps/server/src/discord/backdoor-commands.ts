// 裏口 Bot B のコマンドパーサ (純関数)。 prefix 既定 '!ob'。
// 卒業生が Discord から「今どの企業にいるか / 学生向け / 業界内向け」を投稿・管理する。

export type BackdoorCommand =
  | { kind: 'help' }
  | { kind: 'show' }
  | { kind: 'link' }
  | { kind: 'delete' }
  | { kind: 'set-name'; value: string }
  | { kind: 'set-company'; value: string }
  | { kind: 'set-students'; value: string }
  | { kind: 'set-industry'; value: string }
  | { kind: 'hide'; target: 'students' | 'industry' }
  | { kind: 'none' }
  | { kind: 'unknown' };

export function parseBackdoorCommand(content: string, prefix: string): BackdoorCommand {
  const trimmed = content.trim();
  if (!trimmed.startsWith(prefix)) return { kind: 'none' };

  const rest = trimmed.slice(prefix.length).trim();
  if (!rest || rest === 'help') return { kind: 'help' };

  const [sub, ...parts] = rest.split(/\s+/);
  const value = parts.join(' ').trim();

  switch (sub) {
    case 'show':
      return { kind: 'show' };
    case 'link':
      return { kind: 'link' };
    case 'delete':
      return { kind: 'delete' };
    case 'name':
      return value ? { kind: 'set-name', value } : { kind: 'unknown' };
    case 'company':
      return value ? { kind: 'set-company', value } : { kind: 'unknown' };
    case 'students':
      return value ? { kind: 'set-students', value } : { kind: 'unknown' };
    case 'industry':
      return value ? { kind: 'set-industry', value } : { kind: 'unknown' };
    case 'hide':
      if (value === 'students' || value === 'industry') return { kind: 'hide', target: value };
      return { kind: 'unknown' };
    default:
      return { kind: 'unknown' };
  }
}

export function renderBackdoorHelp(prefix: string): string {
  return [
    'Tirocinium 裏口 (卒業生向け) コマンド:',
    `- \`${prefix} link\` : 裏口ページを開くワンタイムリンクを DM で受け取る`,
    `- \`${prefix} company <社名>\` : 今いる企業を登録する`,
    `- \`${prefix} students <本文>\` : 学生に向けたメッセージを掲載する`,
    `- \`${prefix} industry <本文>\` : 業界内に向けたメッセージを掲載する`,
    `- \`${prefix} name <表示名>\` : 表示名を設定する`,
    `- \`${prefix} hide students|industry\` : 掲載を取り下げる`,
    `- \`${prefix} show\` : 今の登録内容を確認する`,
    `- \`${prefix} delete\` : 自分の登録を削除する`,
  ].join('\n');
}
