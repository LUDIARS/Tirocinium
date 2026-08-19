import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
