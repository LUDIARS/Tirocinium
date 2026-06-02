// claude Code CLI を print mode (-p) で呼ぶバックエンド。
//
// ANTHROPIC_API_KEY を持たない 1 台環境 (Windows Local / dev) で、面接官応答を
// Anthropic API でなく既ログインの claude CLI に肩代わりさせるための層。
// ft-loop も同じヘルパーを使う (scripts/ft-loop/claude-cli.ts は本ファイルを re-export)。
//
// 注意: Windows では claude CLI が CLAUDE_CODE_GIT_BASH_PATH を要求するため、
//       server プロセスの env に設定しておくこと (spec/setup/windows-local-dev.md)。

import { spawn } from 'node:child_process';
import type { Turn } from './types.js';

export type ClaudeCliModel = 'sonnet' | 'haiku' | 'opus';

/**
 * claude CLI を print mode で 1 回呼び、応答テキスト全体を返す。
 * - プロンプトは stdin 経由 (Windows の引数長制限 ENAMETOOLONG 回避)。
 * - env はそのまま継承する。
 */
export function runClaudeCli(prompt: string, model?: ClaudeCliModel): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const args = ['-p'];
    if (model) args.push('--model', model);

    const child = spawn('claude', args, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
    });
    child.stderr.on('data', (d: string) => {
      err += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out.trim());
      } else {
        const detail = (err || out).trim().slice(0, 500);
        reject(new Error(`claude CLI exited with ${code ?? 'null'}: ${detail}`));
      }
    });

    child.stdin.end(prompt, 'utf8');
  });
}

/** 面接官 1 turn 分のプロンプトを組む (system + 会話履歴 + 指示)。 */
function buildInterviewerCliPrompt(systemPrompt: string, turns: Turn[]): string {
  const history = turns
    .map((t) => `${t.role === 'interviewer' ? '面接官' : '受験者'}: ${t.text}`)
    .join('\n');
  return [
    systemPrompt,
    '',
    '## これまでの面接',
    history,
    '',
    '面接官として、次の発話 (質問) を 1 つだけ出力してください。発話文のみを出力してください。',
  ].join('\n');
}

export type StreamResponseCliInput = {
  systemPrompt: string;
  turns: Turn[];
  signal?: AbortSignal;
  model?: ClaudeCliModel;
};

/**
 * claude CLI 経由で面接官応答を生成し、stdout chunk を逐次 yield する。
 * streamResponse (Anthropic SDK 版) と同じ async generator interface を持つ。
 * - claude -p の stdout は生成に伴って流れてくるため、擬似ストリームになる。
 * - signal が abort されたら子プロセスを kill する (barge-in 対応)。
 */
export async function* streamResponseCli(
  input: StreamResponseCliInput,
): AsyncGenerator<string, void, unknown> {
  const prompt = buildInterviewerCliPrompt(input.systemPrompt, input.turns);
  const args = ['-p'];
  if (input.model) args.push('--model', input.model);

  const child = spawn('claude', args, {
    shell: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');

  const onAbort = () => child.kill();
  if (input.signal) {
    if (input.signal.aborted) child.kill();
    else input.signal.addEventListener('abort', onAbort);
  }

  child.stdin.end(prompt, 'utf8');

  try {
    for await (const chunk of child.stdout) {
      yield chunk as string;
    }
  } finally {
    if (input.signal) input.signal.removeEventListener('abort', onAbort);
  }
}
