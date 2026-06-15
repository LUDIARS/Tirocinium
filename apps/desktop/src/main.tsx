import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import { LoginGate } from './auth/LoginGate.js';
import { Recommend } from './pages/Recommend.js';
import { Companies } from './pages/Companies.js';
import { GameSearch } from './pages/GameSearch.js';
import { CompanyMap } from './pages/CompanyMap.js';
import { HomePage } from './pages/HomePage.js';
// 面接ページ (履歴から復元)。ナビには載せず URL 直アクセスのみで開く (配線しない)。
import { SessionStart } from './pages/SessionStart.js';
import { SessionLive } from './pages/SessionLive.js';
import { SessionSummary } from './pages/SessionSummary.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <LoginGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />}>
              <Route index element={<HomePage />} />
              <Route path="companies" element={<Companies />} />
              <Route path="game-search" element={<GameSearch />} />
              <Route path="map" element={<CompanyMap />} />
              <Route path="recommend" element={<Recommend />} />
              {/* 面接ページ: URL 直アクセス用 (ナビリンクは張らない)。入口は /session/start */}
              <Route path="session/start" element={<SessionStart />} />
              <Route path="session/:id" element={<SessionLive />} />
              <Route path="session/:id/summary" element={<SessionSummary />} />
              <Route path="*" element={<Navigate to="/companies" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </LoginGate>
    </AuthProvider>
  </React.StrictMode>,
);
