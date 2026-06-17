/**
 * Portal exclusivo para usuarios con rol 'reader'.
 * Solo muestra el módulo de vocabulario. No hay sección de perfil ni cambio de contraseña.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookText } from 'lucide-react';
import { getCurrentSession, listReaderVocabulary, logoutSession, logReaderSession } from '../services/api';
import { VocabularyViewer } from '../components/VocabularyViewer';
import type { VocabularyList } from '../types';

export function ReaderPortal() {
  const navigate = useNavigate();
  const user = getCurrentSession();
  const [vocabLists, setVocabLists] = useState<VocabularyList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void logReaderSession().catch(() => {});
    void listReaderVocabulary(user.id)
      .then(setVocabLists)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  // Redirigir si token expira
  useEffect(() => {
    const handler = () => navigate('/login', { replace: true, state: { message: 'Tu sesión ha expirado.' } });
    window.addEventListener('session-expired', handler);
    return () => window.removeEventListener('session-expired', handler);
  }, [navigate]);

  if (!user) return null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Navbar */}
      <nav className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-teal-600 text-white">
              <BookText size={18} />
            </span>
            <div>
              <h1 className="font-bold leading-tight">Vocabulario</h1>
              <p className="text-xs text-slate-500">Hola, {user.name} (@{user.username})</p>
            </div>
          </div>
          <button
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
            onClick={() => { void logoutSession().then(() => navigate('/login', { replace: true })); }}
          >
            Cerrar sesión
          </button>
        </div>
      </nav>

      {/* Contenido */}
      <div className="mx-auto max-w-5xl px-4 py-8">
        {loading
          ? <p className="text-center text-sm text-slate-400 py-12">Cargando vocabulario…</p>
          : <VocabularyViewer lists={vocabLists} />}
      </div>
    </main>
  );
}
