import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import DOMPurify from 'dompurify';
import { RichText } from './RichText';
import type { Worksheet, WorksheetActivity } from '../types';

// Actividades que NO se pueden pasar a papel (requieren audio/micrófono).
function isPrintable(a: WorksheetActivity): boolean {
  return !a.type.startsWith('listening') && a.type !== 'speaking' && a.type !== 'conversation';
}

function hash(s: string): number {
  return [...s].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
}

/** Mismo orden barajado que ve el alumno en pantalla (activityRegistry.shuffledByHash): determinista por (id, valor). */
function shuffledByHash<T>(items: T[], seed: string): T[] {
  return [...items].sort((a, b) => hash(`${seed}:${String(a)}`) - hash(`${seed}:${String(b)}`));
}

/** Líneas en blanco para escribir la respuesta. */
function WriteLines({ n = 2 }: { n?: number }) {
  return (
    <div className="mt-1 grid gap-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="wp-writeline" />
      ))}
    </div>
  );
}

/** Texto con `\n` y con huecos `_____` convertidos en líneas para escribir. */
function BlankText({ text }: { text: string }) {
  const parts = (text ?? '').replace(/\\n/g, '\n').split('_____');
  return (
    <span className="whitespace-pre-line">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span className="wp-blank" />}
        </span>
      ))}
    </span>
  );
}

/** Una actividad en formato papel. Devuelve null si no es imprimible. */
function PrintActivity({ activity, n }: { activity: WorksheetActivity; n: number }) {
  const a = activity;
  const head = (body: ReactNode) => (
    <div className="wp-activity">
      {a.instructions && <p className="wp-instr">{a.instructions}</p>}
      {body}
    </div>
  );
  const num = <span className="wp-num">{n}.</span>;

  switch (a.type) {
    case 'fillblank':
      return head(<p>{num} <BlankText text={a.text} /></p>);

    case 'dragdrop':
      return head(
        <div>
          <p>{num} <BlankText text={a.text} /></p>
          <p className="wp-bank">Banco: {shuffledByHash(a.bank, a.id).join('  ·  ')}</p>
        </div>,
      );

    case 'multiplechoice':
    case 'multiselect':
    case 'imagechoice': {
      const multi = a.type === 'multiselect';
      const options = shuffledByHash(a.options, a.id);
      // imagechoice en papel: la imagen del enunciado arriba y la miniatura dentro de su opción.
      const imageOf = (opt: string) => (a.type === 'imagechoice' ? a.option_images?.[a.options.indexOf(opt)] : undefined);
      return head(
        <div>
          <p>{num} <RichText text={a.question} /> {multi && <em className="wp-hint">(varias)</em>}</p>
          {a.type === 'imagechoice' && a.image && <img src={a.image} alt="" className="wp-img" />}
          <div className="wp-opts">
            {options.map((opt, i) => (
              <div key={i} className="wp-opt">
                <span className="wp-mark">{multi ? '☐' : `${String.fromCharCode(65 + i)})`}</span>
                {imageOf(opt)
                  ? <img src={imageOf(opt)} alt={opt} className="wp-img wp-img-opt" />
                  : <span><RichText text={opt} /></span>}
              </div>
            ))}
          </div>
        </div>,
      );
    }

    case 'truefalse':
      return head(
        <div>
          <p>{num} <span className="wp-hint">Marca T (verdadero) o F (falso).</span></p>
          <div className="mt-1 grid gap-1">
            {a.statements.map((s, i) => (
              <div key={i} className="wp-tf">
                <span><RichText text={s.text} /></span>
                <span className="wp-tf-opt">T&nbsp;&nbsp;&nbsp;F</span>
              </div>
            ))}
          </div>
        </div>,
      );

    case 'readingtruefalse':
      return head(
        <div>
          <p>{num} <strong>{a.title}</strong></p>
          <p className="wp-reading"><RichText text={a.content} /></p>
          <div className="mt-1 grid gap-1">
            {a.statements.map((s, i) => (
              <div key={i} className="wp-tf">
                <span><RichText text={s.text} /></span>
                <span className="wp-tf-opt">T&nbsp;&nbsp;&nbsp;F</span>
              </div>
            ))}
          </div>
        </div>,
      );

    case 'matching':
    case 'imagematching': {
      const right = [...a.right]
        .map((t) => ({ t, k: hash(`${a.id}:${t}`) }))
        .sort((x, y) => x.k - y.k)
        .map((x) => x.t);
      // imagematching en papel: la misma tabla de dos columnas, con la miniatura en vez del texto.
      const leftImages = a.type === 'imagematching' ? a.left_images : undefined;
      return head(
        <div>
          <p>{num} <span className="wp-hint">Escribe la letra correcta en cada línea.</span></p>
          <div className="wp-match">
            <div>
              {a.left.map((l, i) => (
                <div key={i} className="wp-match-row">
                  {i + 1}. <span className="wp-blank wp-blank-sm" />{' '}
                  {leftImages?.[i] ? <img src={leftImages[i]} alt={l} className="wp-img wp-img-opt" /> : l}
                </div>
              ))}
            </div>
            <div>
              {right.map((r, i) => (
                <div key={i} className="wp-match-row">{String.fromCharCode(65 + i)}. {r}</div>
              ))}
            </div>
          </div>
        </div>,
      );
    }

    case 'reading':
      return head(
        <div>
          <p>{num} <strong>{a.title}</strong></p>
          <p className="wp-reading"><RichText text={a.content} /></p>
          {a.questions.length > 0 && (
            <div className="mt-1 grid gap-2">
              {a.questions.map((q, i) => (
                <div key={i}>
                  <p className="wp-subq">{i + 1}) <RichText text={q} /></p>
                  <WriteLines n={2} />
                </div>
              ))}
            </div>
          )}
        </div>,
      );

    case 'imagequestion':
      return head(
        <div>
          <p>{num} <RichText text={a.prompt} /></p>
          {a.image && <img src={a.image} alt="" className="wp-img" />}
          <WriteLines n={2} />
        </div>,
      );

    case 'textbox':
      return head(
        <div>
          <p>{num} <RichText text={a.prompt} /></p>
          <WriteLines n={4} />
        </div>,
      );

    case 'content':
      // Repaso informativo: se imprime como contenido (sin numerar), HTML saneado.
      return (
        <div className="wp-activity rich-content">
          {a.title && <p><strong>{a.title}</strong></p>}
          <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(a.html ?? '') }} />
        </div>
      );

    default:
      return null;
  }
}

/** Vista imprimible (papel) de una hoja de trabajo. Se muestra en un modal y usa
 *  la impresión nativa del navegador (Imprimir → Guardar como PDF). */
export function WorksheetPrint({ worksheet, onClose }: { worksheet: Worksheet; onClose: () => void }) {
  const rawBlocks = worksheet.blocks?.length
    ? worksheet.blocks
    : [{ title: null, instructions: null, activities: worksheet.activities }];

  // Filtra actividades no imprimibles y descarta bloques que queden vacíos.
  const blocks = rawBlocks
    .map((b) => ({ ...b, activities: b.activities.filter(isPrintable) }))
    .filter((b) => b.activities.length > 0);

  const totalRaw = rawBlocks.reduce((s, b) => s + b.activities.length, 0);
  const printableCount = blocks.reduce((s, b) => s + b.activities.length, 0);
  const skipped = totalRaw - printableCount;

  const headerFields = worksheet.infoFields?.length ? worksheet.infoFields : ['Nombre', 'Fecha', 'Sección'];

  let counter = 0;

  return createPortal(
    <div className="wp-portal">
      <div className="wp-no-print sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-rex-light bg-white px-4 py-3">
        <div className="text-sm text-ink">
          Vista de impresión · <strong>{worksheet.title}</strong>
          {skipped > 0 && <span className="ml-2 rounded-full bg-spike/10 px-2 py-0.5 text-xs font-semibold text-spike-dark">{skipped} actividad{skipped !== 1 ? 'es' : ''} de audio/habla omitida{skipped !== 1 ? 's' : ''}</span>}
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 rounded-2xl bg-rex px-4 py-2 text-sm font-semibold text-white hover:bg-rex-dark" onClick={() => window.print()}>
            <Printer size={16} /> Imprimir / Guardar PDF
          </button>
          <button className="flex items-center gap-1.5 rounded-2xl border border-rex-light px-4 py-2 text-sm font-semibold text-ink hover:bg-rex-light" onClick={onClose}>
            <X size={16} /> Cerrar
          </button>
        </div>
      </div>

      <div className="wp-sheet">
        <header className="wp-head">
          <img src="/mascot/rex-logo.png" alt="" className="wp-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <h1 className="wp-title">{worksheet.title}</h1>
          {worksheet.description && <p className="wp-desc"><RichText text={worksheet.description} /></p>}
          <div className="wp-fields">
            {headerFields.map((f) => (
              <span key={f} className="wp-field">{f}: <span className="wp-blank" /></span>
            ))}
          </div>
        </header>

        {blocks.map((block, bi) => (
          <section key={bi} className="wp-block">
            {block.title && <h2 className="wp-block-title">{block.title}</h2>}
            {block.instructions && <p className="wp-block-instr">{block.instructions}</p>}
            <div className="wp-block-body">
              {block.activities.map((a) => {
                if (a.type !== 'content') counter += 1; // content no consume número
                return <PrintActivity key={a.id} activity={a} n={counter} />;
              })}
            </div>
          </section>
        ))}

        {printableCount === 0 && (
          <p className="wp-empty">Esta hoja solo tiene actividades de audio/habla, que no se pueden imprimir en papel.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
