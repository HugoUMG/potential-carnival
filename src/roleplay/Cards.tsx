import type { RoleplayCard } from '../types';

const ICON: Record<string, string> = {
  menu: '🍽️', ticket: '✈️', profile: '🙂', job: '📢', cv: '📄', catalog: '🏷️',
  reservation: '🛎️', services: '🏨', patient: '🩺', places: '📍',
};

/** Las tarjetas de la partida (menú, pase de abordar, CV…). Las ve el alumno y las conoce la IA:
 *  en ellas está todo lo que se puede preguntar. Un mismo componente; `kind` solo cambia el estilo. */
export function Cards({ cards }: { cards: RoleplayCard[] }) {
  return (
    <div className="rp-cards">
      {cards.map((card, k) => (
        <article key={k} className={`rp-card rp-card-${card.kind}`}>
          <header>
            <span className="rp-card-icon" aria-hidden>{ICON[card.kind] ?? '📋'}</span>
            <div>
              <h3>{card.title}</h3>
              {card.subtitle && <p>{card.subtitle}</p>}
            </div>
          </header>
          {card.sections.map((s, i) => (
            <section key={i}>
              <h4>{s.title}</h4>
              <ul>
                {s.rows.map((r, j) => (
                  <li key={j}>
                    <span className="rp-row-label">{r.label}</span>
                    {r.value && <span className="rp-row-dots" aria-hidden />}
                    {r.value && <span className="rp-row-value">{r.value}</span>}
                    {r.detail && <small>{r.detail}</small>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {card.notes.length > 0 && (
            <div className="rp-card-notes">
              {card.notes.map((n, i) => <p key={i} className={n.startsWith('⚠') ? 'alert' : ''}>{n}</p>)}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export function Missions({ missions }: { missions: string[] }) {
  return (
    <div className="rp-missions">
      <h3>🎯 Tu misión</h3>
      <ol>{missions.map((m, i) => <li key={i}>{m}</li>)}</ol>
    </div>
  );
}
