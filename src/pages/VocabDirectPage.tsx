import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { VocabularyViewer } from '../components/VocabularyViewer';
import { LoadingScreen } from '../components/LoadingScreen';
import { getPublicVocabulary } from '../services/api';
import type { VocabularyList } from '../types';

/** Enlace directo por lista de vocabulario (/v/:vocabId): se ve sin login ni menú, solo esa lista. */
export function VocabDirectPage() {
  const { vocabId } = useParams<{ vocabId: string }>();
  const [list, setList] = useState<VocabularyList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!vocabId) return;
    let alive = true;
    (async () => {
      try {
        const v = await getPublicVocabulary(vocabId);
        if (alive) setList(v);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Vocabulario no disponible.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [vocabId]);

  if (loading) return <LoadingScreen message="Cargando vocabulario…" />;

  if (error || !list) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="max-w-md rounded-3xl bg-white p-8 shadow-sm">
          <p className="text-4xl">🔒</p>
          <h1 className="mt-3 text-lg font-bold text-slate-900">Vocabulario no disponible</h1>
          <p className="mt-2 text-sm text-slate-500">{error} El enlace puede estar deshabilitado o ser incorrecto.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl px-4">
        <VocabularyViewer lists={[list]} />
      </div>
    </main>
  );
}
