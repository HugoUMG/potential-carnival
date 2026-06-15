import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import App from './App';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ReaderPortal } from './pages/ReaderPortal';
import { VocabPublicPage } from './pages/VocabPublicPage';
import { getCurrentSession } from './services/api';

/** Redirige desde / al portal correcto según el rol, o a /login si no hay sesión. */
function RootRedirect() {
  const session = getCurrentSession();
  if (!session) return <Navigate to="/login" replace />;
  if (session.role === 'admin') return <Navigate to="/admin" replace />;
  if (session.role === 'teacher') return <Navigate to="/teacher" replace />;
  if (session.role === 'reader') return <Navigate to="/reader" replace />;
  return <Navigate to="/student" replace />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/student"
          element={
            <ProtectedRoute allowedRoles={['student']}>
              <App />
            </ProtectedRoute>
          }
        />

        <Route
          path="/teacher"
          element={
            <ProtectedRoute allowedRoles={['teacher', 'admin']}>
              <App />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
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
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
