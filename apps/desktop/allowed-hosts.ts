// Vite dev server の allowedHosts を環境変数から組み立てる (vite.config.ts 専用)。
// Excubitor は全サービスへ LUDIARS_ALLOWED_HOSTS (例 ".ai-run-do.com") を注入する。
// 拠点ごとの追加は従来どおり VITE_ALLOWED_HOSTS。どちらも CSV で、先頭ドットは
// 「そのドメインとサブドメイン」を表す (Vite の allowedHosts と同じ意味)。
// URL・userinfo・ポート・ワイルドカードは Host 検査を緩めすぎるので受け付けない。

const HOST = /^\.?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function parseAllowedHosts(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => {
      if (!h) return false;
      if (!HOST.test(h)) {
        console.warn(`[vite] allowed host を無視しました (ホスト名ではありません): ${h}`);
        return false;
      }
      return true;
    });
}

export function allowedHostsFromEnv(env: NodeJS.ProcessEnv): string[] {
  const hosts = [
    'localhost',
    '127.0.0.1',
    ...parseAllowedHosts(env['LUDIARS_ALLOWED_HOSTS']),
    ...parseAllowedHosts(env['VITE_ALLOWED_HOSTS']),
  ];
  return [...new Set(hosts)];
}
