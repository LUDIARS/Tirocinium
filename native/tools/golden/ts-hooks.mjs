// golden 記録用の Node ローダ: TS の '.js' 指定を '.ts' に読み替え、SDK 等の外部依存を空の stub にする
// (純関数だけを呼ぶので SDK の実体は不要。ネットワークにも触れない)。
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUBS = {
  '@anthropic-ai/sdk': 'export default class Anthropic {}',
  openai: 'export default class OpenAI {}',
  '@ludiars/one-shot': 'export function spawnOneShot() { throw new Error("stub"); }',
  '@ludiars/blackbox': 'export function makeSqliteBlackBox() { throw new Error("stub"); }',
  postgres: 'export default function postgres() { throw new Error("stub"); }',
  ws: 'export class WebSocket {} export class WebSocketServer {}',
  '@grpc/grpc-js': 'export const credentials = {}; export function loadPackageDefinition() { return {}; }',
  '@grpc/proto-loader': 'export function loadSync() { return {}; }',
};

// ワークスペース内パッケージはソースを直接読む (dist は無い)。
const ROOT = new URL('../../../', import.meta.url);
const WORKSPACE = {
  '@tirocinium/llm': 'packages/llm/src/index.ts',
  '@tirocinium/companies': 'packages/companies/src/index.ts',
  '@tirocinium/voice': 'packages/voice/src/index.ts',
  '@tirocinium/analytics': 'packages/analytics/src/index.ts',
};

export async function resolve(specifier, context, next) {
  if (Object.hasOwn(STUBS, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
  if (Object.hasOwn(WORKSPACE, specifier)) return { url: new URL(WORKSPACE[specifier], ROOT).href, shortCircuit: true };
  if (specifier.endsWith('.js') && context.parentURL?.startsWith('file:')) {
    const url = new URL(specifier, context.parentURL);
    const path = fileURLToPath(url);
    const ts = path.replace(/\.js$/, '.ts');
    if (!existsSync(path) && existsSync(ts)) return { url: pathToFileURL(ts).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
  return next(url, context);
}
