// runtime config (Vite env から取り込み or 既定値)
const env =(import.meta as unknown as { env?: Record<string, string> }).env ?? {};

// 既定は同一オリジン (空文字 = 相対パス → vite proxy が server:8084 へ流す)。
// CORS 不要・Tunnel 経由でもそのまま動く。絶対 URL を使いたい時だけ VITE_SERVER_URL を指定。
export const SERVER_URL: string = env['VITE_SERVER_URL'] ?? '';

function deriveWsUrl(): string {
  if (env['VITE_WS_URL']) return env['VITE_WS_URL'];
  if (SERVER_URL) return SERVER_URL.replace(/^http/, 'ws');
  // 同一オリジン: 現在ページの scheme/host から導出
  if (typeof window !== 'undefined') {
    const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsScheme}://${window.location.host}`;
  }
  return '';
}
export const WS_URL: string = deriveWsUrl();
export const CERNERE_AUDIENCE: string = env['VITE_CERNERE_AUDIENCE'] ?? 'tirocinium';
// Windows Local / dev: server 側 TIROCINIUM_DEV_AUTH=1 と対。Cernere 無しで
// ログインを通すための開発専用バイパス。本番ビルドでは未設定にすること。
export const DEV_AUTH: boolean = env['VITE_DEV_AUTH'] === '1' || env['VITE_DEV_AUTH'] === 'true';
