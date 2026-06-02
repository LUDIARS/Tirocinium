// runtime config (Vite env から取り込み or 既定値)
declare const __VITE_DEFAULTS__: undefined;
void __VITE_DEFAULTS__;

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

export const SERVER_URL: string = env['VITE_SERVER_URL'] ?? 'http://localhost:8084';
export const WS_URL: string = env['VITE_WS_URL'] ?? `ws://${new URL(SERVER_URL).host}`;
export const CERNERE_AUDIENCE: string = env['VITE_CERNERE_AUDIENCE'] ?? 'tirocinium';
// Windows Local / dev: server 側 TIROCINIUM_DEV_AUTH=1 と対。Cernere 無しで
// ログインを通すための開発専用バイパス。本番ビルドでは未設定にすること。
export const DEV_AUTH: boolean = env['VITE_DEV_AUTH'] === '1' || env['VITE_DEV_AUTH'] === 'true';
