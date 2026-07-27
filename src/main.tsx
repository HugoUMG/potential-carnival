import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReaderPortal } from './pages/ReaderPortal';
import { VocabPublicPage } from './pages/VocabPublicPage';
import { GuestPage } from './pages/GuestPage';
import { DirectWorksheetPage } from './pages/DirectWorksheetPage';
import { VocabDirectPage } from './pages/VocabDirectPage';
import { SiteLayout } from './pages/site/SiteLayout';
import { HomePage } from './pages/site/HomePage';
import { AboutPage } from './pages/site/AboutPage';
import { ActivitiesPage } from './pages/site/ActivitiesPage';
import { LearnPage } from './pages/site/LearnPage';
import { DevShots } from './pages/DevShots';
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill';
import { initTheme } from './utils/theme';

// Windows no renderiza banderas (muestra "MX"/"GT"); este polyfill carga la fuente
// "Twemoji Country Flags" para que se vean igual en PC y Android.
polyfillCountryFlagEmojis();

// Tema claro/oscuro guardado, antes del primer render (evita el parpadeo).
initTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Sitio público: lo primero que ve quien llega sin sesión. */}
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/acerca" element={<AboutPage />} />
          <Route path="/actividades" element={<ActivitiesPage />} />
          <Route path="/aprende" element={<LearnPage />} />
        </Route>

        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />

        {/* `:section?` = cada opción del portal es su propia URL (/teacher/revision,
            /student/calificadas…): se puede compartir, marcar y volver con el navegador. */}
        <Route
          path="/student/:section?"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <App />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher/:section?"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <App />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/:section?"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <App />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reader"
          element={
            <ProtectedRoute allowedRoles={['reader']}>
              <ReaderPortal />
            </ProtectedRoute>
          }
        />

        <Route path="/vocab" element={<VocabPublicPage />} />
        <Route path="/guest" element={<GuestPage />} />
        <Route path="/w/:worksheetId" element={<DirectWorksheetPage />} />
        <Route path="/v/:vocabId" element={<VocabDirectPage />} />
        {/* Banco de capturas del editor para /aprende. Solo en dev: no entra al build. */}
        {import.meta.env.DEV && <Route path="/__shots" element={<DevShots />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
