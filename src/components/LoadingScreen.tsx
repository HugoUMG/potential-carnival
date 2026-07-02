/** Spinner circular (CSS puro, sin dependencias). */
export function Spinner({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-slate-300 border-t-violet-600 ${className}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 12)) }}
      role="status"
      aria-label="Cargando"
    />
  );
}

/** Pantalla de carga a página completa: indica que la app está viva mientras responde la BD. */
export function LoadingScreen({ message = 'Cargando…' }: { message?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Spinner size={48} />
        <p className="text-sm font-medium text-slate-500">{message}</p>
      </div>
    </div>
  );
}
