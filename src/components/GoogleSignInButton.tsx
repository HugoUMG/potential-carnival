import { useEffect, useRef } from 'react';
import { useTheme } from '../utils/theme';

/**
 * Botón oficial de Google Identity Services.
 *
 * Google devuelve un ID token (JWT) que el backend valida en `POST /auth/google`; si el
 * correo no existe, crea el profesor. No se usa el flujo de código de autorización, así
 * que el `client_secret` no vive en el frontend.
 *
 * Necesita `VITE_GOOGLE_CLIENT_ID`. Sin esa variable el botón simplemente no se muestra.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SRC = 'https://accounts.google.com/gsi/client';

interface GoogleIdApi {
  accounts: {
    id: {
      initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
    };
  };
}

declare global {
  interface Window { google?: GoogleIdApi }
}

/** Carga el script de Google una sola vez, aunque haya varios botones en la sesión. */
function loadGoogleScript(): Promise<void> {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
  if (existing) return existing.dataset.loaded ? Promise.resolve() : new Promise((res) => existing.addEventListener('load', () => res()));
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.onload = () => { script.dataset.loaded = '1'; resolve(); };
    script.onerror = () => reject(new Error('No se pudo cargar Google Sign-In'));
    document.head.appendChild(script);
  });
}

export function GoogleSignInButton({ text, onCredential, onError }: {
  text: 'signin_with' | 'signup_with';
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const theme = useTheme();
  // El callback se lee de una ref: Google guarda el que reciba en initialize, y sin esto
  // se quedaría con el primer render (estado viejo al iniciar sesión).
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID || !holder.current) return;
    let cancelled = false;
    void loadGoogleScript()
      .then(() => {
        if (cancelled || !holder.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => callback.current(response.credential),
        });
        holder.current.innerHTML = '';
        window.google.accounts.id.renderButton(holder.current, {
          type: 'standard',
          theme: theme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          width: 320,
          text,
          locale: 'es',
        });
      })
      .catch(() => { if (!cancelled) onError('No se pudo cargar el acceso con Google. Revisa tu conexión.'); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, text]);

  if (!CLIENT_ID) return null;
  return <div className="flex justify-center" ref={holder} />;
}
