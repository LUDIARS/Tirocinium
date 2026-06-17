import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import { LoginGate } from './auth/LoginGate.js';
import { Recommend } from './pages/Recommend.js';
import { Companies } from './pages/Companies.js';
import { GameSearchList } from './pages/GameSearchList.js';
import { GameRelated } from './pages/GameRelated.js';
import { CompanyMap } from './pages/CompanyMap.js';
import { HomePage } from './pages/HomePage.js';
import { ReferencePage } from './pages/ReferencePage.js';
import { ObMessagesPage } from './pages/ObMessagesPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
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
              <Route path="game-search">
                <Route index element={<GameSearchList />} />
                <Route path=":gameId" element={<GameRelated />} />
              </Route>
              <Route path="map" element={<CompanyMap />} />
              <Route path="recommend" element={<Recommend />} />
              <Route path="reference" element={<ReferencePage />} />
              <Route path="ob-messages" element={<ObMessagesPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
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
