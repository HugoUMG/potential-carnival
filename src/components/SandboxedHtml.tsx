import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Renderiza HTML completo (con su propio CSS, <script> y fuentes) dentro de un iframe
 * AISLADO. `sandbox="allow-scripts"` SIN `allow-same-origin`: los scripts corren, pero el
 * iframe es un origen opaco → no puede tocar el DOM, cookies ni localStorage de la app
 * (sin XSS al portal) y sus estilos no se filtran.
 *
 * El contenido se muestra en un **recuadro de altura acotada** (`maxHeight`): si el documento
 * es más alto, el iframe hace scroll interno y se muestra un aviso "desliza para ver más".
 * Si es más corto, el recuadro se ajusta al contenido (sin espacio sobrante).
 *
 * ponytail: NO agregar `allow-same-origin` junto a `allow-scripts` — el script podría
 *           quitarse el propio sandbox. Mantener solo `allow-scripts`.
 */

// Script inyectado en el iframe para reportar su altura real al padre.
const resizeSnippet = (id: string) => `
<script>(function(){
  function post(){try{parent.postMessage({__ch:document.documentElement.scrollHeight,__id:${JSON.stringify(id)}},'*');}catch(e){}}
  window.addEventListener('load',post);
  if(window.ResizeObserver){try{new ResizeObserver(post).observe(document.documentElement);}catch(e){}}
  window.addEventListener('resize',post);
  setTimeout(post,300);setTimeout(post,1200);
})();</script>`;

/** Aviso flotante de "contenido desplazable" (para overlays sobre iframe o div con scroll). */
export function ScrollHint() {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-xl bg-gradient-to-t from-white/90 to-transparent" />
      <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-slate-900/75 px-3 py-1 text-xs font-semibold text-white shadow">↕ Desliza para ver todo el contenido</span>
    </>
  );
}

export function SandboxedHtml({ html, maxHeight = 560 }: { html: string; maxHeight?: number }) {
  const id = useMemo(() => 'sbx-' + Math.random().toString(36).slice(2), []);
  const [contentHeight, setContentHeight] = useState(maxHeight);
  const ref = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    const snip = resizeSnippet(id);
    return html.includes('</body>') ? html.replace('</body>', snip + '</body>') : html + snip;
  }, [html, id]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Solo aceptar mensajes de ESTE iframe y con nuestro id (leemos únicamente un número).
      if (ref.current && e.source === ref.current.contentWindow && e.data && e.data.__id === id && typeof e.data.__ch === 'number') {
        setContentHeight(Math.min(Math.max(e.data.__ch, 120), 20000));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  const capped = contentHeight > maxHeight + 4; // el documento no cabe → hay scroll interno
  const boxHeight = Math.min(contentHeight, maxHeight);

  return (
    <div className="relative">
      <iframe
        ref={ref}
        title="Contenido"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        loading="lazy"
        className="block w-full rounded-xl border border-slate-200 bg-white"
        style={{ height: boxHeight }}
      />
      {capped && <ScrollHint />}
    </div>
  );
}
