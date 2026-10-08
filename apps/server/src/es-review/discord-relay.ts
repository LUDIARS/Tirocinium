import { claimDelivery, consumePairing, finishDelivery, relayDestination } from './routing.js';

type Message = {
  id: string; channel_id: string; guild_id?: string; content: string;
  author: { id: string; bot?: boolean };
  attachments?: unknown[];
};
type Send = (channelId: string, content: string) => Promise<void>;

/** Text-only transport; never log or persist a message body or Discord error payload. */
export async function handleReviewMessage(message: Message, prefix: string, send: Send): Promise<boolean> {
  const start = `${prefix} es`;
  if (message.content !== start && !message.content.startsWith(`${start} `)) return false;
  if (message.author.bot) return true;
  if (message.guild_id) {
    await send(message.channel_id, 'ES の連絡は Bot との個別 DM で行ってください。ここには本文や接続コードを投稿しないでください。');
    return true;
  }
  try {
    if (message.attachments?.length) {
      await send(message.channel_id, '添付ファイルには対応していません。氏名・連絡先を除いたテキストを送ってください。');
      return true;
    }
    const args = message.content.slice(start.length).trim();
    const pair = /^connect ([a-f0-9]{64})$/.exec(args);
    if (pair) {
      const route = await consumePairing(pair[1]!, message.channel_id);
      await send(message.channel_id, route
        ? `接続しました。返信: ${prefix} es reply ${route.alias} 本文\n氏名・連絡先・URLを含めないでください。`
        : '接続コードが無効・期限切れ、または相談が終了しています。Tirocinium で再発行してください。');
      return true;
    }
    const reply = /^reply ([a-f0-9]{16})\s+([\s\S]+)$/.exec(args);
    if (!reply) {
      await send(message.channel_id, `Tirocinium の相談画面で接続コードを取得してください。返信: ${prefix} es reply 相談番号 本文`);
      return true;
    }
    const body = reply[2]!.trim();
    // Free text cannot guarantee anonymity. Reject obvious contact channels; never silently redact an ES.
    if (!body || body.length > 1400 || /https?:\/\/|www\.|discord\.(?:gg|com)|<[@#]|@[\w.-]+|\b\d{2,4}[-ー]\d{2,4}[-ー]\d{3,4}\b/i.test(body)) {
      await send(message.channel_id, '本文は1〜1400文字で、連絡先・URL・メンションを除いて送ってください。長いESは分割できます。');
      return true;
    }
    const destination = await relayDestination(reply[1]!, message.channel_id);
    if (!destination) {
      await send(message.channel_id, '送信できません。相談番号、双方のBot接続、相談が継続中かをTirociniumで確認してください。');
      return true;
    }
    if (!await claimDelivery(message.id, destination.requestId)) return true;
    try {
      await send(destination.channelId, `【ES相談 ${destination.alias}】${destination.role === 'student' ? '学生' : 'OB'}から\n${body}\n\n返信: ${prefix} es reply ${destination.alias} 本文`);
      await finishDelivery(message.id, 'sent');
    } catch {
      await finishDelivery(message.id, 'unknown');
      await send(message.channel_id, '配送を確認できませんでした。自動再送はしません。相手の受信状況を確認してから再投稿してください。');
      return true;
    }
    await send(message.channel_id, 'Bot 経由で送りました。');
  } catch {
    // Discord API errors can include submitted content. Only a fixed user-facing failure is emitted.
    await send(message.channel_id, 'ES仲介処理を完了できませんでした。しばらくして相談画面の状態を確認してください。').catch(() => undefined);
  }
  return true;
}
