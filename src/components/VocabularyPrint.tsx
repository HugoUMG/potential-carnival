import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { RichText } from './RichText';
import type { VocabularyItem, VocabularyList } from '../types';

// Las 5 formas del verbo (base + las 4 columnas guardadas).
const VERB_FORMS: { label: string; key: 'english' | 'v_past' | 'v_participle' | 'v_ing' | 'v_3rd' }[] = [
  { label: 'Base', key: 'english' },
  { label: 'Simple Past', key: 'v_past' },
  { label: 'Past Participle', key: 'v_participle' },
  { label: '-ing', key: 'v_ing' },
  { label: '3rd Person', key: 'v_3rd' },
];

const isVerb = (item: VocabularyItem) => item.type.toLowerCase() === 'verb';

/** Agrupa por categoría (`block`), preservando el orden de inserción. */
function groupByCategory(items: VocabularyItem[]) {
  const groups: { label: string; items: VocabularyItem[] }[] = [];
  for (const item of items) {
    const label = item.block?.trim() || '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function WordRow({ item }: { item: VocabularyItem }) {
  return (
    <div className="wp-vrow">
      <p>
        <span className="wp-vword">{item.english}</span>
        <span className="wp-ves"> — {item.spanish}</span>
        <span className="wp-vtype">{item.type}</span>
      </p>
      {isVerb(item) && (
        <div className="wp-vforms">
          {VERB_FORMS.map((f) => (
            <span key={f.label} className="wp-vform">
              <span className="wp-vform-l">{f.label}</span>
              {item[f.key] || '—'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Vista imprimible (papel) de una lista de vocabulario: secciones por categoría
 *  con el título remarcado; los verbos muestran sus 5 formas. Impresión nativa. */
export function VocabularyPrint({ list, onClose }: { list: VocabularyList; onClose: () => void }) {
  const groups = groupByCategory(list.items);

  return createPortal(
    <div className="wp-portal">
      <div className="wp-no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="text-sm text-slate-600">
          Vista de impresión · <strong>{list.title}</strong>
          <span className="ml-2 text-xs text-slate-400">{list.items.length} palabras</span>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 rounded-2xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir / Guardar PDF
          </button>
          <button className="flex items-center gap-1.5 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50" onClick={onClose}>
            <X size={16} /> Cerrar
          </button>
        </div>
      </div>

      <div className="wp-sheet">
        <header className="wp-head">
          <h1 className="wp-title">{list.title}</h1>
          {list.description && <p className="wp-desc"><RichText text={list.description} /></p>}
        </header>

        {groups.map((group, gi) => (
          <section key={gi} className="wp-block">
            {group.label && <h2 className="wp-block-title">{group.label}</h2>}
            <div className="wp-vlist">
              {group.items.map((item, i) => <WordRow key={`${item.english}-${i}`} item={item} />)}
            </div>
          </section>
        ))}

        {list.items.length === 0 && <p className="wp-empty">Esta lista no tiene palabras.</p>}
      </div>
    </div>,
    document.body,
  );
}
