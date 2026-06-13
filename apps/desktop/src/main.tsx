import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { App } from './App.js';
import { AuthProvider } from './auth/AuthContext.js';
import { LoginGate } from './auth/LoginGate.js';
import { Recommend } from './pages/Recommend.js';
import { Companies } from './pages/Companies.js';
import { HomePage } from './pages/HomePage.js';
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
              <Route path="recommend" element={<Recommend />} />
              <Route path="*" element={<Navigate to="/companies" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </LoginGate>
    </AuthProvider>
  </React.StrictMode>,
);
