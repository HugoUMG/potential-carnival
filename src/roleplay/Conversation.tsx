import { useCallback, useEffect, useRef, useState } from 'react';
import { ClipboardList, Keyboard, Lightbulb, Mic, PartyPopper, RotateCcw, SendHorizontal, Snail, Square, Target, Volume2, X } from 'lucide-react';
import { EmojiIcon } from '../components/AppIcon';
import { roleplayTurn, transcribeWithClarity } from '../services/api';
import type { RoleplayMessage, RoleplayStart } from '../types';
import { Cards, Missions } from './Cards';
import { canRecord, play, playStream, say, stopVoice, useRecorder, voiceRate } from './media';
import { matchSpoken, words } from '../games/util';
import { Practice } from './Practice';

export interface Prefs {
  en: boolean;
  es: boolean;
  slow: boolean;
}

/** `audio`: la voz que llegó con la línea (blob:), para repetirla sin volver a pedirla.
 *  `hints`: las respuestas posibles de "¿Qué digo?" (solo en las líneas del personaje). */
export type Msg = RoleplayMessage & { es?: string; audio?: string; hints?: string[] };
type Phase = 'thinking' | 'speaking' | 'listen' | 'transcribing' | 'done' | 'error';

/** Con menos palabras la claridad de Whisper no dice nada (igual que `MIN_WORDS_FOR_CLARITY` del backend). */
const MIN_WORDS_FOR_CLARITY = 3;
const measured = (m: Msg) => m.clarity != null && m.text.trim().split(/\s+/).length >= MIN_WORDS_FOR_CLARITY;

/** Respuestas mínimas antes de poder terminar y pedir la nota. */
const MIN_TO_FINISH = 3;

export function Conversation({ session, prefs, setPrefs, onExit, onFinish }: {
  session: RoleplayStart;
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  onExit: () => void;
  onFinish: (history: Msg[]) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [phase, setPhase] = useState<Phase>('thinking');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(canRecord ? '' : 'Tu navegador no permite grabar: escribe tus respuestas.');
  const [typing, setTyping] = useState(!canRecord);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState(false);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  // Lo que Whisper oyó con poca claridad: el alumno lo confirma o lo graba otra vez antes de que el
  // personaje conteste a algo que no dijo.
  const [unsure, setUnsure] = useState<{ text: string; clarity: number } | null>(null);
  // Índice de la línea del personaje con las pistas abiertas: solo la última se puede pedir.
  const [hintsFor, setHintsFor] = useState<number | null>(null);
  const rec = useRecorder();
  const started = useRef(false);
  // Cada pedido al personaje lleva un número: si el alumno lo interrumpe, la frase cortada no
  // vuelve a cambiar la fase cuando ya se está pidiendo la siguiente.
  const turn = useRef(0);
  const [closing, setClosing] = useState(false);
  const failed = useRef<Msg[]>([]);
  const end = useRef<HTMLDivElement>(null);
  const rate = useRef(voiceRate(session.rate, prefs.slow));
  rate.current = voiceRate(session.rate, prefs.slow);
  const answered = msgs.filter((m) => m.who === 'user').length;
  const beginner = session.level === 'beginner';
  const hasSide = session.cards.length > 0 || session.missions.length > 0;

  const ask = useCallback(async (history: Msg[]) => {
    const id = ++turn.current;
    setPhase('thinking');
    setError('');
    try {
      const { reply: r, voice } = await roleplayTurn(session, history, rate.current);
      const msg: Msg = { who: 'ai', text: r.reply, es: r.reply_es, hints: r.hints ?? [] };
      // El texto aparece cuando la voz empieza a sonar (o a los 3 s si tarda): juntos, no uno 8 s antes.
      let shown = false;
      const show = () => {
        if (shown || id !== turn.current) return;
        shown = true;
        setMsgs([...history, msg]);
        setClosing(r.done);
        setPhase('speaking');
      };
      const late = setTimeout(show, 3000);
      const audio = await playStream(voice, show);
      clearTimeout(late);
      show();
      if (audio) setMsgs((all) => all.map((m) => (m === msg ? { ...m, audio } : m)));
      else if (audio === undefined && id === turn.current) await say(r.reply, session.ai_voice, rate.current);
      if (id === turn.current) setPhase(r.done ? 'done' : 'listen');
    } catch (e) {
      failed.current = history;
      setError(e instanceof Error ? e.message : 'El personaje no respondió.');
      setPhase('error');
    }
  }, [session]);

  // La escena la abre el personaje. El ref evita el doble arranque del StrictMode en desarrollo.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void ask([]);
  }, [ask]);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs.length, phase]);
  useEffect(() => () => stopVoice(), []);

  const send = (text: string, clarity: number | null) => {
    stopVoice();
    setUnsure(null);
    // Con las pistas abiertas, una respuesta que repite el 80 % de una cuenta como leída.
    const shown = hintsFor === msgs.length - 1 ? msgs[hintsFor]?.hints ?? [] : [];
    const hinted = shown.some((h) => {
      const hit = matchSpoken(words(h), text);
      return hit.length > 0 && hit.filter(Boolean).length / hit.length >= 0.8;
    });
    setHintsFor(null);
    const next: Msg[] = [...msgs, { who: 'user', text, clarity, hinted }];
    setMsgs(next);
    setDraft('');
    void ask(next);
  };

  const talk = async () => {
    if (rec.recording) { rec.stop(); return; }
    stopVoice();
    setNotice('');
    setUnsure(null);
    let blob: Blob | null;
    try {
      blob = await rec.start();
    } catch {
      setNotice('No se pudo usar el micrófono. Revisa el permiso (icono del candado) o escribe tu respuesta.');
      setTyping(true);
      return;
    }
    if (!blob) { setNotice('No se grabó audio. Intenta otra vez.'); return; }
    setPhase('transcribing');
    try {
      const { transcript, clarity } = await transcribeWithClarity(blob);
      if (!transcript.trim()) {
        setNotice('No te escuché bien. Acércate al micrófono e intenta otra vez.');
        setPhase('listen');
        return;
      }
      const heard: Msg = { who: 'user', text: transcript.trim(), clarity };
      if (measured(heard) && clarity! < session.clarity_ok) {
        setUnsure({ text: heard.text, clarity: clarity! });
        setPhase('listen');
        return;
      }
      send(heard.text, clarity);
    } catch {
      setNotice('No se pudo entender el audio. Intenta otra vez o escribe tu respuesta.');
      setPhase('listen');
    }
  };

  // Se puede contestar sin esperar a que el personaje termine de hablar (salvo su despedida).
  const yourTurn = phase === 'listen' || (phase === 'speaking' && !closing);
  const playLine = (text: string, slow = false) => void say(text, session.ai_voice, slow ? voiceRate(session.rate, true) : rate.current);
  const status = {
    thinking: `${session.ai_name} está pensando…`,
    speaking: 'Escucha con atención…',
    listen: rec.recording ? `Te escucho… ${rec.seconds}s · toca de nuevo para enviar` : typing ? 'Tu turno: escribe tu respuesta en inglés.' : 'Tu turno: toca el micrófono y responde en inglés.',
    transcribing: 'Entendiendo lo que dijiste…',
    done: <><PartyPopper size={15} className="inline align-[-2px]" /> ¡Conversación terminada!</>,
    error: error,
  }[phase];

  return (
    <div className="rp-talk">
      <header className="rp-talk-top">
        <button type="button" className="rp-icon-btn" onClick={() => { stopVoice(); onExit(); }} aria-label="Salir de la conversación"><X size={20} /></button>
        <div className="rp-talk-title">
          <small>{session.title} · {session.place}</small>
          <b className="inline-flex items-center gap-1.5"><EmojiIcon emoji={session.ai_emoji} size={18} /> {session.ai_name} <span>({session.ai_role})</span></b>
        </div>
        <div className="rp-toggles" role="group" aria-label="Subtítulos y velocidad">
          <button type="button" aria-pressed={prefs.en} onClick={() => setPrefs({ ...prefs, en: !prefs.en })} title="Subtítulos en inglés">EN</button>
          {beginner && <button type="button" aria-pressed={prefs.es} onClick={() => setPrefs({ ...prefs, es: !prefs.es })} title="Traducción al español">ES</button>}
          <button type="button" aria-pressed={prefs.slow} onClick={() => setPrefs({ ...prefs, slow: !prefs.slow })} title="Voz más lenta"><Snail size={15} /></button>
        </div>
      </header>

      <div className="rp-progress" aria-label={`${answered} de ${session.max_turns} respuestas`}>
        {Array.from({ length: session.max_turns }, (_, i) => <span key={i} className={i < answered ? 'on' : ''} />)}
      </div>

      <div className={`rp-talk-body ${hasSide ? '' : 'solo'}`}>
        <div className="rp-chat">
          <div className="rp-msgs" aria-live="polite">
            {msgs.map((m, i) => (m.who === 'ai' ? (
              <div key={i} className="rp-msg ai">
                <span className="rp-av" aria-hidden><EmojiIcon emoji={session.ai_emoji} size={26} /></span>
                <div className={`rp-bubble ${phase === 'speaking' && i === msgs.length - 1 ? 'speaking' : ''}`}>
                  {prefs.en || revealed.has(i) ? <p className="rp-en">{m.text}</p> : <p className="rp-audio-only"><span className="rp-wave" aria-hidden><i /><i /><i /><i /></span> Solo audio</p>}
                  {beginner && prefs.es && m.es && <p className="rp-es">{m.es}</p>}
                  <div className="rp-tools">
                    <button type="button" onClick={() => void (m.audio ? play(m.audio) : say(m.text, session.ai_voice, rate.current))} aria-label="Escuchar otra vez"><Volume2 size={16} /></button>
                    <button type="button" onClick={() => void say(m.text, session.ai_voice, voiceRate(session.rate, true))} aria-label="Escuchar lento"><Snail size={16} /></button>
                    {!prefs.en && (
                      <button type="button" className="rp-reveal" onClick={() => setRevealed((r) => { const n = new Set(r); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>
                        {revealed.has(i) ? 'Ocultar texto' : 'Ver texto'}
                      </button>
                    )}
                    {i === msgs.length - 1 && yourTurn && !!m.hints?.length && (
                      <button type="button" className="rp-reveal" aria-expanded={hintsFor === i} onClick={() => setHintsFor(hintsFor === i ? null : i)}>
                        <Lightbulb size={13} /> ¿Qué digo?
                      </button>
                    )}
                    {/* Repetir la frase pide verla: en "solo audio" aparece al tocar "Ver texto". */}
                    {(prefs.en || revealed.has(i)) && <Practice text={m.text} play={playLine} label="Repetir" />}
                  </div>
                  {hintsFor === i && i === msgs.length - 1 && yourTurn && (
                    <div className="rp-hints">
                      <small>Podrías decir algo como (toca para escucharlo):</small>
                      {m.hints!.map((h) => <button key={h} type="button" onClick={() => playLine(h)}><Volume2 size={13} /> {h}</button>)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div key={i} className="rp-msg me">
                <div className="rp-bubble">
                  <p>{m.text}</p>
                  {m.hinted && <span className="rp-clarity hint"><Lightbulb size={12} /> con pista</span>}
                  <span className={`rp-clarity ${!measured(m) ? '' : m.clarity! >= session.clarity_ok ? 'ok' : 'low'}`}>
                    {m.clarity == null ? <><Keyboard size={12} /> escrito</> : <><Mic size={12} /> claridad {Math.round(m.clarity)}%</>}
                  </span>
                </div>
              </div>
            )))}
            {phase === 'thinking' && (
              <div className="rp-msg ai">
                <span className="rp-av" aria-hidden><EmojiIcon emoji={session.ai_emoji} size={26} /></span>
                <div className="rp-bubble rp-typing" aria-label="Escribiendo"><i /><i /><i /></div>
              </div>
            )}
            <div ref={end} />
          </div>

          <p className={`rp-status ${phase}`}>{status}</p>
          {notice && <p className="rp-notice">{notice}</p>}

          <div className="rp-controls">
            {phase === 'error' ? (
              <button type="button" className="rp-btn primary" onClick={() => void ask(failed.current)}><RotateCcw size={16} /> Reintentar</button>
            ) : phase === 'done' ? (
              <button type="button" className="rp-btn primary big" onClick={() => onFinish(msgs)}><Target size={16} /> Ver mi nota</button>
            ) : unsure && !rec.recording ? (
              <div className="rp-unsure" role="group" aria-label="Confirmar lo que se escuchó">
                <p>No te entendí del todo ({Math.round(unsure.clarity)}% de claridad). ¿Dijiste esto?</p>
                <q>{unsure.text}</q>
                <div className="rp-unsure-btns">
                  <button type="button" className="rp-btn" onClick={() => void talk()}><Mic size={16} /> Grabar otra vez</button>
                  <button type="button" className="rp-btn primary" onClick={() => send(unsure.text, unsure.clarity)}><SendHorizontal size={16} /> Enviar así</button>
                </div>
              </div>
            ) : typing ? (
              <form className="rp-type" onSubmit={(e) => { e.preventDefault(); if (draft.trim() && yourTurn) send(draft.trim(), null); }}>
                {canRecord && <button type="button" className="rp-icon-btn" onClick={() => setTyping(false)} aria-label="Volver al micrófono"><Mic size={18} /></button>}
                <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write your answer in English…" aria-label="Tu respuesta" maxLength={500} />
                <button type="submit" className="rp-send" disabled={!draft.trim() || !yourTurn} aria-label="Enviar"><SendHorizontal size={18} /></button>
                {hasSide && <button type="button" className="rp-icon-btn" onClick={() => setPanel(true)} aria-label="Ver información y misión"><ClipboardList size={18} /></button>}
              </form>
            ) : (
              <div className="rp-mic-row">
                <button type="button" className="rp-icon-btn" onClick={() => setTyping(true)} aria-label="Escribir en vez de hablar"><Keyboard size={18} /></button>
                <button type="button" className={`rp-mic ${rec.recording ? 'on' : ''}`} onClick={() => void talk()}
                  disabled={!yourTurn && !rec.recording} aria-label={rec.recording ? 'Enviar mi respuesta' : 'Hablar'}
                  style={{ boxShadow: rec.recording ? `0 0 0 ${8 + rec.level * 22}px rgba(239, 68, 68, .22)` : undefined }}>
                  {rec.recording ? <Square size={28} /> : <Mic size={32} />}
                </button>
                {hasSide && <button type="button" className="rp-icon-btn" onClick={() => setPanel(true)} aria-label="Ver información y misión"><ClipboardList size={18} /></button>}
              </div>
            )}
            {answered >= MIN_TO_FINISH && phase !== 'done' && (
              <button type="button" className="rp-link" disabled={phase === 'thinking' || rec.recording} onClick={() => { stopVoice(); onFinish(msgs); }}>
                Terminar ahora y ver mi nota
              </button>
            )}
          </div>
        </div>

        {hasSide && (
          <aside className={`rp-side ${panel ? 'open' : ''}`} aria-label="Información y misión">
            <button type="button" className="rp-side-close rp-icon-btn" onClick={() => setPanel(false)} aria-label="Cerrar"><X size={18} /></button>
            {session.missions.length > 0 && <Missions missions={session.missions} />}
            {session.cards.length > 0 && (
              <>
                <div className="rp-info-head">
                  <h3 className="flex items-center gap-2"><ClipboardList size={18} /> Información para la conversación</h3>
                  <p>Lo que tú y {session.ai_name} saben. Úsala para preguntar y responder; no hace falta leerla toda.</p>
                </div>
                <Cards cards={session.cards} />
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
