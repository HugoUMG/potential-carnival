import RexMascot from './RexMascot';

/** Spinner circular (CSS puro, sin dependencias). */
export function Spinner({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-rex/30 border-t-rex ${className}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 12)) }}
      role="status"
      aria-label="Cargando"
    />
  );
}

/** Mascota RexLearn pensando + spinner. */
function DinoLoader({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <RexMascot mood="thinking" className="dino-bob h-28 w-28 drop-shadow-md" />
      <Spinner size={44} />
      <p className="text-sm font-semibold text-rex-deep">{message}</p>
    </div>
  );
}

/** Pantalla de carga a página completa: indica que la app está viva mientras responde la BD. */
export function LoadingScreen({ message = 'Cargando…' }: { message?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-cream px-6">
      <DinoLoader message={message} />
    </div>
  );
}

/** Overlay de carga (sobre el contenido actual): p. ej. mientras se envían y califican respuestas. */
export function LoadingOverlay({ message = 'Enviando tus respuestas…' }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-cream/85 px-6 backdrop-blur-sm">
      <DinoLoader message={message} />
    </div>
  );
}
