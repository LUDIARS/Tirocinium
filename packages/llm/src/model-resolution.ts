import { MODEL_ROLES, resolveModel } from '@ludiars/one-shot';
import { contract } from './contracts/runtime.js'; /* augur-inject:import:f4882d79 */
import augurContract_017e333b from './contracts/model-resolution.contract.js'; /* augur-inject:contract-predicate:8c25e116 */

/** HTTP requests require a model ID. Lapilli also permits aliases for Claude Code. */
export function resolveRequestModel(
  selection: string,
  provider: 'claude' | 'codex',
  env: NodeJS.ProcessEnv = process.env,
): string {
  const roles: readonly string[] = MODEL_ROLES[provider];
  if (!roles.includes(selection)) return selection;
  const model = resolveModel(selection, provider, env);
  if (model === selection) throw new Error(`model_role_unresolved:${selection}`);
  return model;
}
// @ts-expect-error augur-inject
resolveRequestModel = contract(resolveRequestModel, { ...augurContract_017e333b, contractId: 'C-5', mode: 'observe', sample: 1, where: 'packages/llm/src/model-resolution.ts:4', rule: 'contract-wrap', id: '017e333b' }); /* augur-inject:contract-wrap:017e333b */
