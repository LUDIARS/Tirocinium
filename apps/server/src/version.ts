/**
 * サービスが名乗る版 (AIFormat RULE_SRE.md §2)。
 *
 * @implements SPEC-SERVICE-RUNTIME-VERSION
 *
 * 解決順は Excubitor 注入 → サービス固有 env → npm の package version → 'unknown'。
 * ここに版をハードコードしない (ディスク上の実体とずれると突合の意味が無くなる)。
 */
export function serviceVersion(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env['EXCUBITOR_SERVICE_VERSION']
    ?? env['TIROCINIUM_SERVICE_VERSION']
    ?? env['npm_package_version']
    ?? 'unknown'
  );
}
