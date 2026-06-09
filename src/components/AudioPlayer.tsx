/**
 * Reproductor de audio TTS para actividades de listening.
 * Descarga el audio como blob antes de reproducir — evita problemas de streaming.
 * Incluye control de velocidad (útil para aprendizaje de idiomas).
 *
 * Exporta dos componentes:
 *  - AudioPlayer  → reproductor completo para actividades listening
 *  - TtsButton    → botón compacto para vocabulario (icono de altavoz)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Pause, Play, RefreshCw, Volume2, VolumeX } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
const DEFAULT_VOICE = 'en-US-GuyNeural';

function buildTtsUrl(text: string, voice = DEFAULT_VOICE) {
  return `${API_BASE}/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;
}

// ── Hook compartido: descarga blob y gestiona estado ─────────────────────────

function useAudioBlob(text: string, voice?: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const prevUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    // Revoca la URL anterior antes de crear una nueva
    if (prevUrl.current) {
      URL.revokeObjectURL(prevUrl.current);
      prevUrl.current = null;
    }
    setBlobUrl(null);
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(buildTtsUrl(text, voice));
      if (!res.ok) throw new Error(`TTS error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      prevUrl.current = url;
      setBlobUrl(url);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [text, voice]);

  // Carga automática al montar y cuando cambia el texto
  useEffect(() => {
    void load();
    return () => {
      if (prevUrl.current) URL.revokeObjectURL(prevUrl.current);
    };
  }, [load]);

  return { blobUrl, loading, error, reload: load };
}

// ── Reproductor completo ──────────────────────────────────────────────────────

interface AudioPlayerProps {
  text: string;
  voice?: string;
}

export function AudioPlayer({ text, voice }: AudioPlayerProps) {
  const { blobUrl, loading, error, reload } = useAudioBlob(text, voice);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  // Aplica velocidad al audio element cuando cambia
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  // Cuando el blob carga, precarga el elemento de audio
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    setDuration(0);
  }, [blobUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;
    if (playing) {
      audio.pause();
    } else {
      audio.playbackRate = speed;
      void audio.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Number(e.target.value);
    setProgress(Number(e.target.value));
  };

  const fmt = (s: number) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  const progressPct = duration > 0 && isFinite(duration) ? (progress / duration) * 100 : 0;

  /**
   * Safari bug: blob URLs de audio devuelven duration=Infinity en onLoadedMetadata.
   * Fix: forzar seek a un número muy alto para que Safari escanee el archivo completo
   * y dispare un segundo evento con la duración real.
   */
  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isFinite(audio.duration)) {
      audio.currentTime = 1e101; // fuerza a Safari a leer hasta el final
    } else {
      setDuration(audio.duration);
    }
  };

  const handleDurationChange = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isFinite(audio.duration)) {
      setDuration(audio.duration);
      audio.currentTime = 0; // regresa al inicio tras el scan de Safari
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
      {/* Hidden audio element */}
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          preload="auto"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setProgress(0); }}
          onTimeUpdate={() => { if (audioRef.current) setProgress(audioRef.current.currentTime); }}
          onLoadedMetadata={handleLoadedMetadata}
          onDurationChange={handleDurationChange}
        />
      )}

      <div className="flex items-center gap-3">
        {/* Play / Pause */}
        <button
          type="button"
          onClick={togglePlay}
          disabled={loading || error || !blobUrl}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition
            ${loading || !blobUrl ? 'bg-slate-200 text-slate-400' : 'bg-blue-600 text-white shadow-sm hover:bg-blue-700'}
            disabled:cursor-not-allowed`}
        >
          {loading
            ? <Loader2 size={16} className="animate-spin" />
            : playing
              ? <Pause size={16} />
              : <Play size={16} className="translate-x-0.5" />}
        </button>

        {/* Barra de progreso */}
        <div className="relative flex-1">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.05}
            value={progress}
            onChange={handleSeek}
            disabled={!blobUrl || loading}
            className="w-full cursor-pointer accent-blue-600 disabled:cursor-default disabled:opacity-40"
          />
          {/* Barra de progreso visual */}
          <div
            className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-blue-600/30 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Tiempo */}
        <span className="shrink-0 font-mono text-xs text-slate-500 tabular-nums">
          {fmt(progress)}<span className="text-slate-300"> / </span>{fmt(duration)}
        </span>

        {/* Velocidad */}
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="shrink-0 rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-700 outline-none focus:border-blue-400"
          title="Velocidad de reproducción"
        >
          <option value={0.5}>0.5×</option>
          <option value={0.75}>0.75×</option>
          <option value={1}>1×</option>
          <option value={1.25}>1.25×</option>
        </select>

        {/* Reintentar si hay error */}
        {error && (
          <button
            type="button"
            onClick={() => void reload()}
            className="shrink-0 rounded-lg p-1.5 text-red-500 transition hover:bg-red-50"
            title="Reintentar"
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      {/* Mensaje de error */}
      {error && (
        <p className="text-xs text-red-500">
          No se pudo cargar el audio.{' '}
          <button type="button" className="underline" onClick={() => void reload()}>Reintentar</button>
        </p>
      )}

      {/* Etiqueta de carga */}
      {loading && (
        <p className="text-xs text-slate-400">Generando audio…</p>
      )}
    </div>
  );
}

// ── Botón compacto TTS (para vocabulario) ────────────────────────────────────

interface TtsButtonProps {
  text: string;
  voice?: string;
}

export function TtsButton({ text, voice }: TtsButtonProps) {
  const { blobUrl, loading, error, reload } = useAudioBlob(text, voice);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const handleClick = () => {
    if (error) { void reload(); return; }
    const audio = audioRef.current;
    if (!audio || !blobUrl) return;
    if (playing) {
      audio.pause();
      audio.currentTime = 0;
    } else {
      void audio.play();
    }
  };

  return (
    <>
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        title={error ? 'Error — clic para reintentar' : playing ? 'Detener' : 'Reproducir'}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition
          ${error
            ? 'bg-red-100 text-red-500 hover:bg-red-200'
            : playing
              ? 'bg-indigo-200 text-indigo-700'
              : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'}
          disabled:cursor-default disabled:opacity-50`}
      >
        {loading
          ? <Loader2 size={11} className="animate-spin" />
          : error
            ? <VolumeX size={11} />
            : <Volume2 size={11} />}
      </button>
    </>
  );
}
