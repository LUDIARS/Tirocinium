import { spawnOneShot } from '@ludiars/one-shot';

export function codexTextArgs(model: string): string[] {
  return ['exec', '--model', model, '--ignore-user-config', '--ephemeral', '--sandbox', 'read-only',
    '--disable', 'shell_tool', '--disable', 'unified_exec', '--skip-git-repo-check', '--json', '-'];
}

type TextCliInput = {
  file: string;
  args: string[];
  prompt: string;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  errorPrefix: 'interviewer' | 'refine';
};

/** Collect the bounded stdout of one subscription CLI process. */
export async function runTextCli(input: TextCliInput): Promise<string> {
  const { signal, errorPrefix } = input;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const child = spawnOneShot(input.file, input.args, {
    cwd: process.cwd(),
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.resume();
  let stdout = '';
  let bytes = 0;
  let overflow = false;
  let deadline = false;
  const onData = (chunk: string): void => {
    if (overflow) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) {
      overflow = true;
      child.kill();
      return;
    }
    stdout += chunk;
  };
  const onAbort = (): void => { child.kill(); };
  child.stdout.on('data', onData);
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    deadline = true;
    child.kill();
  }, input.timeoutMs);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', () => reject(new Error(`${errorPrefix}_cli_unavailable`)));
      child.stdin.once('error', () => reject(new Error(`${errorPrefix}_cli_input_failed`)));
      child.once('close', resolve);
      child.stdin.end(input.prompt, 'utf8');
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (code !== 0 || overflow || deadline) {
      throw new Error(`${errorPrefix}_cli_failed:${deadline ? 'timeout' : overflow ? 'output_limit' : 'exit'}`);
    }
    return stdout;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    child.stdout.off('data', onData);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}
