import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App.js';
import { Dashboard } from './pages/Dashboard.js';
import { SessionStart } from './pages/SessionStart.js';
import { SessionLive } from './pages/SessionLive.js';
import { SessionSummary } from './pages/SessionSummary.js';
import { PersonaCatalog } from './pages/PersonaCatalog.js';
import { Reservation } from './pages/Reservation.js';
import { Settings } from './pages/Settings.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Dashboard />} />
          <Route path="start" element={<SessionStart />} />
          <Route path="session/:id" element={<SessionLive />} />
          <Route path="session/:id/summary" element={<SessionSummary />} />
          <Route path="personas" element={<PersonaCatalog />} />
          <Route path="reservation" element={<Reservation />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
