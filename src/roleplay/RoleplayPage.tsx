import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Headphones, Mic, Volume2 } from 'lucide-react';
import RexMascot from '../components/RexMascot';
import { Spinner } from '../components/LoadingScreen';
import { listRoleplayScenarios, roleplayReport, startRoleplay } from '../services/api';
import type { RoleplayLevel, RoleplayReport, RoleplayScenario, RoleplayStart } from '../types';
import { Conversation, type Msg, type Prefs } from './Conversation';
import { Report } from './Report';
import { canRecord, LEVEL_INFO, say, unlockVoice, voiceRate } from './media';
import './roleplay.css';

type Step = 'setup' | 'check' | 'talk' | 'grading' | 'report';
const LEVELS: RoleplayLevel[] = ['beginner', 'intermediate', 'advanced'];

/** /conversacion y /conversacion/:scenarioId — conversación con IA por role-play (ADR-39).
 *  Sin cuenta a propósito: es para practicar sin sentirse juzgado. No se guarda nada. */
export function RoleplayPage() {
  const { scenarioId } = useParams();
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<RoleplayScenario[] | null>(null);
  const [error, setError] = useState('');
  const scenario = scenarios?.find((s) => s.id === scenarioId) ?? null;

  useEffect(() => { listRoleplayScenarios().then(setScenarios, (e: Error) => setError(e.message)); }, []);
  useEffect(() => { document.title = 'Conversación con IA · MyDinoEnglish'; }, []);

  return (
    <div className="rp">
      {error && <p className="rp-notice">No se pudieron cargar los role-plays: {error}</p>}
      {!scenarios && !error && <div className="rp-center"><Spinner /></div>}
      {scenarios && !scenario && <Picker scenarios={scenarios} onPick={(id) => navigate(`/conversacion/${id}`)} />}
      {scenario && <Session key={scenario.id} scenario={scenario} onBack={() => navigate('/conversacion')} />}
    </div>
  );
}

function Picker({ scenarios, onPick }: { scenarios: RoleplayScenario[]; onPick: (id: string) => void }) {
  return (
    <div className="rp-page">
      <Link to="/juegos" className="rp-back"><ArrowLeft size={16} /> MyDinoEnglish</Link>
      <section className="rp-hero">
        <div>
          <p className="rp-eyebrow">Conversación con IA</p>
          <h1>Habla en inglés <span>sin miedo.</span></h1>
          <p>Practica con personajes de inteligencia artificial: no son personas reales, nadie te juzga y puedes equivocarte todo lo que quieras. Al final recibes tu nota y te mostramos cómo decirlo mejor.</p>
        </div>
        <RexMascot mood="wave" className="rp-hero-rex" />
      </section>
      <h2 className="rp-h2">Elige una situación</h2>
      <div className="rp-scenarios">
        {scenarios.map((s) => (
          <button key={s.id} type="button" className="rp-scenario" onClick={() => onPick(s.id)}>
            <span className="rp-scenario-emoji" aria-hidden>{s.emoji}</span>
            <b>{s.title}</b>
            <span>{s.description}</span>
            <small>{s.roles.map((r) => `${r.emoji} ${r.label}`).join('  ·  ')}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function Session({ scenario, onBack }: { scenario: RoleplayScenario; onBack: () => void }) {
  const [step, setStep] = useState<Step>('setup');
  const [role, setRole] = useState(scenario.roles[0].id);
  const [level, setLevel] = useState<RoleplayLevel>('beginner');
  const [prefs, setPrefs] = useState<Prefs>({ en: true, es: true, slow: false });
  const [withInfo, setWithInfo] = useState(true);
  const [withMissions, setWithMissions] = useState(true);
  const [session, setSession] = useState<RoleplayStart | null>(null);
  const [report, setReport] = useState<RoleplayReport | null>(null);
  const [history, setHistory] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pickLevel = (l: RoleplayLevel) => {
    setLevel(l);
    setPrefs({ en: LEVEL_INFO[l].en, es: LEVEL_INFO[l].es, slow: false });
  };

  // Cada partida es nueva: otro seed, otro menú, otro giro. "Repetir" vuelve a pedir una.
  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      setSession(await startRoleplay(scenario.id, role, level, withInfo, withMissions));
      setReport(null);
      setStep('check');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo preparar la conversación.');
    } finally {
      setBusy(false);
    }
  };

  const grade = async (msgs: Msg[]) => {
    if (!session) return;
    setHistory(msgs);
    setStep('grading');
    setError('');
    try {
      setReport(await roleplayReport(session, msgs));
      setStep('report');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular tu nota.');
    }
  };

  if (step === 'talk' && session) {
    return <Conversation session={session} prefs={prefs} setPrefs={setPrefs} onExit={() => setStep('setup')} onFinish={(msgs) => void grade(msgs)} />;
  }
  if (step === 'grading') {
    return (
      <div className="rp-center rp-grading">
        <RexMascot mood="thinking" className="rp-hero-rex" />
        {error ? (
          <>
            <p className="rp-notice">{error}</p>
            <button type="button" className="rp-btn primary" onClick={() => void grade(history)}>Reintentar</button>
          </>
        ) : (
          <><Spinner /><p>Revisando cada una de tus respuestas…</p></>
        )}
      </div>
    );
  }
  if (step === 'report' && report && session) {
    return (
      <div className="rp-page">
        <Report report={report} session={session} onAgain={() => void begin()} onSetup={() => setStep('setup')} onOther={onBack} />
      </div>
    );
  }
  if (step === 'check' && session) {
    return <SoundCheck session={session} prefs={prefs} onBack={() => setStep('setup')} onStart={() => { unlockVoice(); setStep('talk'); }} />;
  }

  return (
    <div className="rp-page">
      <button type="button" className="rp-back" onClick={onBack}><ArrowLeft size={16} /> Otras situaciones</button>
      <section className="rp-setup-head">
        <span className="rp-scenario-emoji big" aria-hidden>{scenario.emoji}</span>
        <div>
          <h1>{scenario.title}</h1>
          <p>{scenario.description}</p>
        </div>
      </section>

      <h2 className="rp-h2">1. ¿Quién quieres ser?</h2>
      <div className="rp-choices two">
        {scenario.roles.map((r) => {
          const other = scenario.roles.find((x) => x.id !== r.id);
          return (
            <button key={r.id} type="button" className={`rp-choice ${role === r.id ? 'on' : ''}`} onClick={() => setRole(r.id)} aria-pressed={role === r.id}>
              <span className="rp-choice-emoji" aria-hidden>{r.emoji}</span>
              <b>{r.label}</b>
              <small>La IA será {other?.emoji} {other?.label.toLowerCase()}</small>
            </button>
          );
        })}
      </div>

      <h2 className="rp-h2">2. Elige tu nivel</h2>
      <div className="rp-choices three">
        {LEVELS.map((l) => (
          <button key={l} type="button" className={`rp-choice level ${level === l ? 'on' : ''}`} onClick={() => pickLevel(l)} aria-pressed={level === l}>
            <span className="rp-choice-emoji" aria-hidden>{LEVEL_INFO[l].emoji}</span>
            <b>{LEVEL_INFO[l].label}</b>
            <ul>{LEVEL_INFO[l].bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          </button>
        ))}
      </div>

      <h2 className="rp-h2">3. Ajusta a tu gusto</h2>
      <div className="rp-prefs">
        <label><input type="checkbox" checked={prefs.en} onChange={(e) => setPrefs({ ...prefs, en: e.target.checked })} /> Ver lo que dice el personaje en inglés</label>
        {level === 'beginner' && (
          <label><input type="checkbox" checked={prefs.es} onChange={(e) => setPrefs({ ...prefs, es: e.target.checked })} /> Ver la traducción al español</label>
        )}
        <label><input type="checkbox" checked={prefs.slow} onChange={(e) => setPrefs({ ...prefs, slow: e.target.checked })} /> Voz todavía más lenta</label>
        <p>{prefs.en ? 'Puedes cambiar esto también durante la conversación.' : '🎧 Modo solo escuchar. Puedes cambiarlo durante la conversación.'}</p>
      </div>

      <h2 className="rp-h2">4. ¿Cómo quieres practicar?</h2>
      <div className="rp-prefs">
        <label><input type="checkbox" checked={withInfo} onChange={(e) => setWithInfo(e.target.checked)} /> Información para la conversación</label>
        <p>{withInfo
          ? 'Tarjetas con los datos de la escena (menú, boleto, CV…) que tú y el personaje conocen. Desactívala para hablar más libre.'
          : 'Conversación libre: sin tarjetas. El personaje sigue en la escena e improvisa los detalles; tú también puedes inventarlos.'}</p>
        <label><input type="checkbox" checked={withMissions} onChange={(e) => setWithMissions(e.target.checked)} /> Misiones</label>
        <p>{withMissions ? 'Dos o tres objetivos que cumplir; cambian en cada partida.' : 'Sin misiones: solo conversas, sin objetivos que cumplir.'}</p>
      </div>

      {error && <p className="rp-notice">{error}</p>}
      <button type="button" className="rp-btn primary big wide" onClick={() => void begin()} disabled={busy}>
        {busy ? 'Preparando…' : 'Continuar'}
      </button>
    </div>
  );
}

function SoundCheck({ session, prefs, onBack, onStart }: { session: RoleplayStart; prefs: Prefs; onBack: () => void; onStart: () => void }) {
  const [heard, setHeard] = useState(false);
  const [mic, setMic] = useState<'idle' | 'ok' | 'denied'>('idle');

  const testSound = () => {
    unlockVoice();
    void say(`Hi! I'm ${session.ai_name}. Can you hear me well?`, session.ai_voice, voiceRate(session.rate, prefs.slow)).then(() => setHeard(true));
  };
  const testMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMic('ok');
    } catch {
      setMic('denied');
    }
  };

  return (
    <div className="rp-page rp-check">
      <button type="button" className="rp-back" onClick={onBack}><ArrowLeft size={16} /> Cambiar rol o nivel</button>
      <h1>Antes de empezar</h1>
      <div className="rp-check-list">
        <div className="rp-check-item">
          <Volume2 size={28} />
          <div>
            <b>Sube el volumen de tu dispositivo</b>
            <p>{session.ai_name} te va a hablar en voz alta. Toca el botón y comprueba que se escucha bien.</p>
          </div>
          <button type="button" className={`rp-btn ${heard ? 'ok' : ''}`} onClick={testSound}>{heard ? <><Check size={16} /> Se escucha</> : 'Probar sonido'}</button>
        </div>
        <div className="rp-check-item">
          <Headphones size={28} />
          <div>
            <b>Usa audífonos</b>
            <p>Se recomiendan para una mejor experiencia: escuchas mejor y el micrófono no capta la voz del personaje.</p>
          </div>
        </div>
        {canRecord && (
          <div className="rp-check-item">
            <Mic size={28} />
            <div>
              <b>Permite el micrófono</b>
              <p>{mic === 'denied' ? 'El navegador bloqueó el micrófono: actívalo en el candado 🔒 o escribe tus respuestas.' : 'Vas a responder hablando. Tu voz solo se usa para entenderte.'}</p>
            </div>
            <button type="button" className={`rp-btn ${mic === 'ok' ? 'ok' : ''}`} onClick={() => void testMic()}>{mic === 'ok' ? <><Check size={16} /> Listo</> : 'Permitir'}</button>
          </div>
        )}
      </div>
      <div className="rp-mission-preview">
        <p className="rp-eyebrow">{session.missions.length ? 'Tu misión' : 'Hablarás'} con {session.ai_emoji} {session.ai_name} ({session.ai_role})</p>
        {session.missions.length > 0
          ? <ol>{session.missions.map((m, i) => <li key={i}>{m}</li>)}</ol>
          : <p><b>Sin misiones:</b> conversa libremente dentro de la escena.</p>}
        <p className="rp-small">{session.cards.length > 0
          ? `Tendrás a la mano la información para la conversación (${session.cards.map((c) => c.title).join(', ')}).`
          : 'Conversación libre: sin tarjetas. El personaje sigue en la escena e improvisa los detalles.'}</p>
      </div>
      <button type="button" className="rp-btn primary big wide" onClick={onStart}>¡Empezar conversación!</button>
    </div>
  );
}
