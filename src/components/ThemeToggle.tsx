import { Moon, Sun } from 'lucide-react';
import { toggleTheme, useTheme } from '../utils/theme';

/** Interruptor claro/oscuro. La pintura la hace app.css a partir de `data-theme`. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme();
  const label = theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className={`flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition hover:border-rex/40 hover:text-rex-deep ${className}`}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
