import { useSyncExternalStore } from 'react';

/**
 * Tema claro/oscuro de TODA la app (sitio público, login, portales, hojas).
 *
 * El tema vive en un solo lugar: el atributo `data-theme` de <html>. La pintura del
 * modo oscuro es CSS puro (`:root[data-theme='dark'] …` en app.css), así que ningún
 * componente necesita saber en qué modo está — solo el interruptor usa este hook.
 */
export type Theme = 'light' | 'dark';

const KEY = 'site-theme';
const listeners = new Set<() => void>();

function stored(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'dark' ? 'dark' : 'light'; // claro por defecto
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
  listeners.forEach((fn) => fn());
}

export function toggleTheme() {
  setTheme(stored() === 'dark' ? 'light' : 'dark');
}

/** Aplica el tema guardado antes del primer render (lo llama main.tsx). */
export function initTheme() {
  applyTheme(stored());
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    stored,
  );
}
