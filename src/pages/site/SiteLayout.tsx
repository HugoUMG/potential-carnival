import { Link, NavLink, Outlet } from 'react-router-dom';
import { BookText, LogIn, Moon, Sun, UserPlus } from 'lucide-react';
import { getCurrentSession } from '../../services/api';
import { toggleTheme, useTheme } from '../../utils/theme';

const NAV = [
  { to: '/', label: 'Inicio', end: true },
  { to: '/acerca', label: 'Acerca de', end: false },
  { to: '/actividades', label: 'Actividades', end: false },
  { to: '/aprende', label: 'Aprende', end: false },
];

function roleRoute(role: string): string {
  if (role === 'admin') return '/admin';
  if (role === 'teacher') return '/teacher';
  if (role === 'reader') return '/reader';
  return '/student';
}

/** Marco del sitio público: navegación por rutas + piel cyber-glass claro/oscuro. */
export function SiteLayout() {
  const session = getCurrentSession();
  const theme = useTheme();

  return (
    // El tema vive en `data-theme` de <html> (src/utils/theme.ts): las variables de
    // app.css hacen el resto, aquí y en el resto de la app.
    <div className="site">
      <header className="sticky top-0 z-50 border-b border-site-fg/10 bg-site-bg/70 backdrop-blur-xl">
        {/* En móvil los enlaces bajan a una segunda fila; desde sm van en línea. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <img
              src="/mascot/rex-logo.svg"
              alt=""
              aria-hidden
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
              // La silueta es negra: en oscuro se pierde contra el fondo, así que se invierte a blanca.
              className={`h-24 w-24 object-contain ${theme === 'dark' ? 'invert' : ''}`}
            />
            <span className="text-lg font-black tracking-tight">
              <span className="site-neon-spike">My</span>Dino<span className="site-neon">English</span>
            </span>
          </Link>

          {/* min-w-0: sin esto el flex item no baja de su contenido y desborda. */}
          <nav className="order-last -mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto px-1 text-sm [scrollbar-width:none] sm:order-none sm:w-auto sm:flex-1">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="site-nav-link whitespace-nowrap">
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-2 sm:ml-0">
            <button
              type="button"
              className="site-theme-toggle"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {session ? (
              <Link to={roleRoute(session.role)} className="site-btn site-btn-primary !px-5 !py-2 text-sm">
                Mi panel
              </Link>
            ) : (
              <>
              {/* max-sm:!hidden y no `hidden sm:inline-flex`: .site-btn se define después
                  de las utilidades de Tailwind y le ganaría el display. */}
                <Link to="/registro" className="site-btn site-btn-ghost !px-4 !py-2 text-sm max-sm:!hidden">
                  <UserPlus size={16} /> Crear cuenta
                </Link>
                <Link to="/vocab" className="site-btn site-btn-ghost !px-4 !py-2 text-sm max-sm:!hidden">
                  <BookText size={16} /> Conoce nuestro vocabulario gratuito
                </Link>
                <Link to="/login" className="site-btn site-btn-primary !px-5 !py-2 text-sm">
                  <LogIn size={16} /> Entrar
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pb-24 pt-10 sm:pt-14">
        <Outlet />
      </main>

      <footer className="relative border-t border-site-fg/10 px-4 py-8 text-center text-sm text-site-fg/45">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {NAV.map((item) => (
            <Link key={item.to} to={item.to} className="transition hover:text-site-fg/80">{item.label}</Link>
          ))}
          <Link to="/vocab" className="transition hover:text-site-fg/80">Vocabulario</Link>
          <Link to="/login" className="transition hover:text-site-fg/80">Entrar</Link>
        </div>
        <p className="mt-4">MyDinoEnglish — hojas de trabajo de inglés, interactivas y calificadas.</p>
      </footer>
    </div>
  );
}
