// runtime config (Vite env から取り込み or 既定値)
declare const __VITE_DEFAULTS__: undefined;
void __VITE_DEFAULTS__;

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

export const SERVER_URL: string = env['VITE_SERVER_URL'] ?? 'http://localhost:8084';
export const WS_URL: string = env['VITE_WS_URL'] ?? `ws://${new URL(SERVER_URL).host}`;
export const CERNERE_AUDIENCE: string = env['VITE_CERNERE_AUDIENCE'] ?? 'tirocinium';
