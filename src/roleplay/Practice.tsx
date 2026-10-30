import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Snail, Square, Volume2 } from 'lucide-react';
import { matchSpoken, tokenize, words } from '../games/util';
import { transcribeAudio } from '../services/api';
import { canRecord, stopVoice, useRecorder } from './media';

/** Repetir una frase (del informe o del personaje): suena el modelo, el alumno la graba y se pintan
 *  en rojo las palabras que Whisper no oyó (la misma comparación que el juego Pronuncia). No cambia la nota. */
export function Practice({ text, play, label = 'Practícala' }: { text: string; play: (text: string, slow?: boolean) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rec = useRecorder(20);
  // Si el alumno sale mientras se transcribe, el resultado viejo no se pinta.
  const attempt = useRef(0);
  useEffect(() => () => { attempt.current++; }, []);

  if (!canRecord) return null;
  if (!open) {
    return <button type="button" className="rp-practice-btn" onClick={() => { setOpen(true); play(text); }}><Mic size={14} /> {label}</button>;
  }

  const target = words(text);
  const hits = heard ? matchSpoken(target, heard) : null;
  const pct = hits ? Math.round((100 * hits.filter(Boolean).length) / Math.max(1, target.length)) : 0;
  let k = 0;
  const marks = tokenize(text).map((t) => ({ raw: t.raw, hit: t.word && hits ? hits[k++] : undefined }));

  const record = async () => {
    if (rec.recording) { rec.stop(); return; }
    const id = ++attempt.current;
    stopVoice();
    setErr('');
    setHeard('');
    try {
      const blob = await rec.start();
      if (id !== attempt.current) return;
      if (!blob) { setErr('No se grabó audio. Intenta otra vez.'); return; }
      setBusy(true);
      const said = (await transcribeAudio(blob)).trim();
      if (id !== attempt.current) return;
      if (said) setHeard(said);
      else setErr('No te escuché bien. Acércate al micrófono e intenta otra vez.');
    } catch {
      if (id === attempt.current) setErr('No se pudo usar el micrófono o entender el audio. Intenta otra vez.');
    } finally {
      if (id === attempt.current) setBusy(false);
    }
  };

  return (
    <div className="rp-practice">
      <p className="rp-practice-target">
        {marks.map((m, i) => (m.hit === undefined ? m.raw : <span key={i} className={m.hit ? 'hit' : 'miss'}>{m.raw}</span>))}
      </p>
      <div className="rp-practice-row">
        <button type="button" onClick={() => play(text)} aria-label="Escuchar el modelo"><Volume2 size={14} /></button>
        <button type="button" onClick={() => play(text, true)} aria-label="Escuchar lento"><Snail size={14} /></button>
        <button type="button" className={`rp-practice-mic ${rec.recording ? 'on' : ''}`} onClick={() => void record()} disabled={busy || rec.starting}
          aria-label={rec.recording ? 'Detener y comparar' : 'Grabarme'}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : rec.recording ? <Square size={14} /> : <Mic size={14} />}
          {busy ? 'Comparando…' : rec.recording ? `${rec.seconds}s · toca para comparar` : heard ? 'Otra vez' : 'Grabarme'}
        </button>
      </div>
      {heard && <p className={`rp-practice-result ${pct >= 80 ? 'ok' : 'low'}`}><b>{pct}%</b> Escuché: “{heard}”</p>}
      {err && <p className="rp-practice-result low">{err}</p>}
    </div>
  );
}
