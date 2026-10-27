import { useCallback, useEffect, useRef, useState } from 'react';

/** ¿Este navegador puede grabar? `getUserMedia` solo existe en contextos seguros (HTTPS o localhost). */
export const canRecord = typeof navigator !== 'undefined'
  && typeof window !== 'undefined'
  && window.isSecureContext
  && !!navigator.mediaDevices?.getUserMedia
  && typeof MediaRecorder !== 'undefined';

const DEFAULT_MAX_SECONDS = 45;

/**
 * Graba el micrófono con `MediaRecorder`. `start()` pide permiso, empieza a grabar y devuelve el
 * `Blob` cuando se llama a `stop()` (o al llegar a `maxSeconds`). `null` si no hubo audio.
 *
 * La usan la conversación con IA y los juegos: así el audio viaja a Whisper y funciona en cualquier
 * navegador que grabe, sin depender de la Web Speech API (que Firefox e iOS no traen).
 */
export function useRecorder(maxSeconds = DEFAULT_MAX_SECONDS) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const busy = useRef(false);
  const alive = useRef(true);
  // Identifica cada grabación: `cancel()` lo sube para que un permiso que llega tarde no empiece a
  // grabar en la pregunta siguiente.
  const run = useRef(0);

  const stop = useCallback((): void => {
    const rec = recorder.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const cancel = useCallback((): void => {
    run.current++;
    setStarting(false);
    stop();
  }, [stop]);

  const start = useCallback(async (): Promise<Blob | null> => {
    if (busy.current) return null;
    busy.current = true;
    const id = ++run.current;
    setStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      // El permiso puede tardar y el alumno irse (o pasar de pregunta) antes: no dejar el micrófono abierto.
      if (!alive.current || id !== run.current) {
        stream.getTracks().forEach((t) => t.stop());
        setStarting(false);
        return null;
      }
      const chunks: Blob[] = [];
      let rec: MediaRecorder;
      try {
        rec = new MediaRecorder(stream);
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        throw err;
      }
      recorder.current = rec;

      const ctx = (() => { try { return new AudioContext(); } catch { return null; } })();
      const began = Date.now();
      let timer = 0;
      if (ctx) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        timer = window.setInterval(() => {
          analyser.getByteFrequencyData(data);
          setLevel(Math.min(1, data.reduce((a, b) => a + b, 0) / data.length / 90));
          const elapsed = Math.floor((Date.now() - began) / 1000);
          setSeconds(elapsed);
          if (elapsed >= maxSeconds) rec.stop();
        }, 100);
      } else {
        // Sin AudioContext no hay barras de volumen, pero la grabación y el corte por tiempo siguen.
        timer = window.setInterval(() => {
          const elapsed = Math.floor((Date.now() - began) / 1000);
          setSeconds(elapsed);
          if (elapsed >= maxSeconds) rec.stop();
        }, 500);
      }
      cleanup.current = () => {
        window.clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        if (ctx) void ctx.close();
        recorder.current = null;
        setRecording(false);
        setLevel(0);
      };

      return await new Promise((resolve, reject) => {
        rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          cleanup.current();
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
          resolve(blob.size ? blob : null);
        };
        try {
          rec.start();
        } catch (err) {
          cleanup.current();
          reject(err);
          return;
        }
        setSeconds(0);
        setRecording(true);
        setStarting(false);
      });
    } catch (err) {
      setStarting(false);
      throw err;
    } finally {
      busy.current = false;
    }
  }, [maxSeconds]);

  // Si el alumno sale a mitad de una grabación (o el permiso llega tarde), el micrófono se suelta.
  useEffect(() => {
    alive.current = true;
    const release = cleanup;
    return () => { alive.current = false; release.current(); };
  }, []);

  return { recording, starting, level, seconds, start, stop, cancel };
}
