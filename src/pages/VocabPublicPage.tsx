import { useEffect, useState } from 'react';
import { BookText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { VocabularyViewer } from '../components/VocabularyViewer';
import type { VocabularyList } from '../types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

interface PublicReader {
  id: string;
  name: string;
  username: string;
  vocabulary_lists: VocabularyList[];
}

export function VocabPublicPage() {
  const navigate = useNavigate();
  const [readers, setReaders] = useState<PublicReader[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch(`${API_BASE}/public/readers-vocabulary`)
      .then((r) => r.json())
      .then((data: PublicReader[]) => {
        setReaders(data);
        if (data[0]) setActiveId(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const active = readers.find((r) => r.id === activeId);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Navbar */}
      <nav className="border-b border-slate-200 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-white">
              <BookText size={18} />
            </span>
            <h1 className="font-bold text-slate-900">Portal de Vocabulario</h1>
          </div>
          <button
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold hover:border-blue-300 hover:text-blue-700 transition-colors"
            onClick={() => navigate('/login')}
          >
            ← Volver al inicio
          </button>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-8">
        {loading ? (
          <p className="py-16 text-center text-sm text-slate-400">Cargando vocabulario…</p>
        ) : readers.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">No hay listas de vocabulario disponibles.</p>
        ) : (
          <>
            {/* Pestañas por reader */}
            <div className="mb-6 flex flex-wrap gap-2">
              {readers.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition-colors ${
                    activeId === r.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white border border-slate-200 text-slate-700 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>

            {/* Vocabulario del reader activo */}
            {active && <VocabularyViewer lists={active.vocabulary_lists} />}
          </>
        )}
      </div>
    </main>
  );
}
