import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// このファイルをコピーして vite.config.ts を作成してください。
// cp vite.config.example.ts vite.config.ts
//
// 外部ホスト (Cloudflare Tunnel / Tailscale 等) からアクセスする場合は
// apps/desktop/.env.local に VITE_ALLOWED_HOSTS を設定してください:
//
//   VITE_ALLOWED_HOSTS=tirocinium.example.com
//
// vite.config.ts はドメイン情報を含むため gitignore 対象です。

// API / WS は同一オリジン (このフロント) で受けて proxy で server(:8084) に流す。
// これで (1) ブラウザのクロスオリジン CORS が不要になり、
//      (2) Cloudflare Tunnel 等の外部ホスト経由でも localhost:8084 直叩き不要になる。
const SERVER_TARGET = process.env.VITE_PROXY_TARGET ?? 'http://localhost:8084';
const extraHosts = process.env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? [];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    host: true,
    allowedHosts: ['localhost', '127.0.0.1', ...extraHosts],
    proxy: {
      '/api': { target: SERVER_TARGET, changeOrigin: true, ws: true },
      '/health': { target: SERVER_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
