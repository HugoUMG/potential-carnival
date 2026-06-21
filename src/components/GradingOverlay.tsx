import { useEffect, useState } from 'react';
import { Loader2, ClipboardCheck } from 'lucide-react';

// Overlay mostrado mientras se envía/califica una hoja. La calificación con IA puede
// tardar varios segundos; una barra que avanza evita que el alumno crea que se trabó.
// El progreso es simulado (la duración real es desconocida): avanza y se detiene ~92%
// hasta que la petición termina y el overlay desaparece.
export function GradingOverlay({ aiGrading = true }: { aiGrading?: boolean }) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => (p >= 92 ? p : p + Math.max(1, Math.round((96 - p) / 14))));
    }, 350);
    return () => clearInterval(id);
  }, []);

  const title = aiGrading ? 'Revisando tus respuestas…' : 'Enviando…';
  const subtitle = aiGrading
    ? 'Estamos revisando y calificando tus respuestas con cuidado. Esto puede tomar un momento — no cierres la página.'
    : 'Guardando tus respuestas…';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/60 p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl">
        <div className="relative mx-auto grid h-20 w-20 place-items-center">
          <Loader2 className="absolute animate-spin text-blue-200" size={80} strokeWidth={1.5} />
          {aiGrading ? <ClipboardCheck className="text-blue-600" size={28} /> : <Loader2 className="animate-spin text-blue-600" size={30} />}
        </div>
        <h2 className="mt-5 text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-blue-600 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-xs font-semibold text-blue-600">{progress}%</p>
      </div>
    </div>
  );
}
