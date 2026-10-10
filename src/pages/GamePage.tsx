import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadingScreen } from '../components/LoadingScreen';
import RexMascot from '../components/RexMascot';
import { GamePlayer } from '../games/GamePlayer';
import { words } from '../games/util';
import { getPublicGameSet } from '../services/api';
import type { PublicGameSet } from '../types';

/** /j/:setId — un set de juegos por enlace directo, sin cuenta (ADR-38). */
export function GamePage() {
  const { setId = '' } = useParams();
  const [set, setSet] = useState<PublicGameSet | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    getPublicGameSet(setId).then((s) => { if (alive) setSet(s); }, (e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [setId]);

  // Un set recién guardado puede abrirse antes de que la IA termine su diccionario (corre en
  // segundo plano): si faltan palabras, se vuelve a pedir una vez a los 20 s, sin recargar.
  const incomplete = !!set && Object.keys(set.glossary).length < new Set(set.questions.flatMap((q) => words(q.text))).size;
  useEffect(() => {
    if (!incomplete) return;
    const t = window.setTimeout(() => {
      getPublicGameSet(setId).then((s) => setSet((prev) => (prev ? { ...prev, glossary: s.glossary } : prev)), () => {});
    }, 20000);
    return () => window.clearTimeout(t);
  }, [incomplete, setId]);

  useEffect(() => { if (set) document.title = `${set.title} · Juegos · MyDinoEnglish`; }, [set]);

  if (error) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-6 text-center">
        <div className="grid justify-items-center gap-3">
          <RexMascot mood="sad" className="w-40" />
          <h1 className="text-2xl font-black text-ink">Este juego no está disponible</h1>
          <p className="text-slate-500">Puede que el enlace esté incompleto o que el profesor lo haya borrado.</p>
          <Link to="/juegos" className="rounded-full bg-rex px-5 py-2.5 font-bold text-white">Ver los juegos</Link>
        </div>
      </div>
    );
  }
  if (!set) return <LoadingScreen message="Cargando el juego…" />;
  return <GamePlayer set={set} />;
}
