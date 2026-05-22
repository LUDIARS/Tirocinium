// claude CLI を print mode (-p) で 1 回呼ぶヘルパー。
//
// ft-loop の examinee / interviewer の応答生成を Anthropic API 直叩きでなく
// Claude Code CLI 経由にするために使う。 評価・サマリ・critique (Opus) は
// 従来どおり API のまま。

import { spawn } from 'node:child_process';

export type ClaudeCliModel = 'sonnet' | 'haiku' | 'opus';

/**
 * claude CLI を print mode で 1 回呼び、 応答テキストを返す。
 *
 * - プロンプトは stdin 経由で渡す (Windows の引数長制限 ENAMETOOLONG 回避)。
 * - env はそのまま継承する (claude CLI が要求する CLAUDE_CODE_GIT_BASH_PATH 等は
 *   呼び出し側シェルで設定しておく)。
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
