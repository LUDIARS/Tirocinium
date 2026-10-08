// claude CLI (-p) を 1 回呼ぶ。シミュレーション専用の薄い呼び出し。
// 対象リポの CLAUDE.md や hooks を読ませないよう、呼び出し側が渡す空の作業フォルダで起動する。
import { spawn } from 'node:child_process';

export function askClaude(prompt: string, cwd: string, model = 'sonnet'): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^[a-z0-9.-]+$/i.test(model)) throw new Error(`invalid model: ${model}`);
    // Windows は claude.cmd 解決のため shell 経由。引数は検証済みの固定値だけを 1 本の文字列で渡す。
    const child = process.platform === 'win32'
      ? spawn(`claude -p --model ${model}`, { cwd, shell: true })
      : spawn('claude', ['-p', '--model', model], { cwd });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.stderr.on('data', (d: string) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude CLI exited with ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
    child.stdin.end(prompt, 'utf8');
  });
}
