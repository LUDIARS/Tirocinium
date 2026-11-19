import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { prepareOneShot, spawnOneShot } from '@ludiars/one-shot';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { LlmBrain } from './brain.js';

vi.mock('@ludiars/one-shot', async importOriginal => ({
  ...await importOriginal<typeof import('@ludiars/one-shot')>(),
  spawnOneShot: vi.fn(),
}));

const directory = mkdtempSync(join(tmpdir(), 'tr-refine-'));
const env = { LUDIARS_MODEL_ROLES_FILE: join(directory, 'roles.json') };
writeFileSync(env.LUDIARS_MODEL_ROLES_FILE, JSON.stringify({
  schemaVersion: 1,
  roles: { codex: { luna: 'codex-fixture-luna' } },
}));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function fakeCodex(events: unknown[], code = 0): { model?: string; prompt?: string } {
  const observed: { model?: string; prompt?: string } = {};
  vi.mocked(spawnOneShot).mockImplementationOnce((file, args, options) => {
    const launch = prepareOneShot(file, args, options);
    observed.model = launch.args[launch.args.indexOf('--model') + 1];
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: code,
    });
    const chunks: Buffer[] = [];
    child.stdin.on('data', chunk => chunks.push(chunk));
    child.stdin.on('finish', () => {
      observed.prompt = Buffer.concat(chunks).toString('utf8');
      child.stdout.end(events.map(event => JSON.stringify(event)).join('\n'));
      child.emit('close', code);
    });
    return child as unknown as ReturnType<typeof spawnOneShot>;
  });
  return observed;
}

const response = [
  { type: 'item.completed', item: { type: 'agent_message', text: ' 技術選定の理由を深掘りする ' } },
  { type: 'turn.completed' },
];

describe('REFINE through Codex One-Shot', () => {
  it('resolves luna without an API key and forwards the interview history over stdin', async () => {
    const observed = fakeCodex(response);
    const brain = new LlmBrain({ llmBackend: 'api', env });
    expect(brain.canRefine()).toBe(true);
    await expect(brain.refineFocus({ turns: [{ turn_no: 1, role: 'user', text: '技術を選びました' }] }))
      .resolves.toBe('技術選定の理由を深掘りする');
    expect(observed.model).toBe('codex-fixture-luna');
    expect(observed.prompt).toContain('技術を選びました');
  });

  it('keeps the explicitly configured model ID', async () => {
    const observed = fakeCodex(response);
    const brain = new LlmBrain({ llmBackend: 'cli', env: { OPENAI_MODEL_REFINE: 'codex-explicit' } });
    await expect(brain.refineFocus({ turns: [] })).resolves.toBe('技術選定の理由を深掘りする');
    expect(observed.model).toBe('codex-explicit');
  });

  it('rejects tool output and a failed process', async () => {
    const brain = new LlmBrain({ llmBackend: 'cli', env });
    fakeCodex([...response, { type: 'item.completed', item: { type: 'command_execution' } }]);
    await expect(brain.refineFocus({ turns: [] })).rejects.toThrow('interviewer_tools_forbidden');
    fakeCodex(response, 1);
    await expect(brain.refineFocus({ turns: [] })).rejects.toThrow('refine_cli_failed:exit');
  });
});
