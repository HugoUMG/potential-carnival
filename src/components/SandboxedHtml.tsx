import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Renderiza HTML completo (con su propio CSS, <script> y fuentes) dentro de un iframe
 * AISLADO. `sandbox="allow-scripts"` SIN `allow-same-origin`: los scripts corren, pero el
 * iframe es un origen opaco → no puede tocar el DOM, cookies ni localStorage de la app
 * (sin XSS al portal) y sus estilos no se filtran. Se auto-ajusta la altura vía postMessage.
 *
 * ponytail: NO agregar `allow-same-origin` junto a `allow-scripts` — el script podría
 *           quitarse el propio sandbox. Mantener solo `allow-scripts`.
 */

// Script inyectado en el iframe para reportar su altura al padre.
const resizeSnippet = (id: string) => `
<script>(function(){
  function post(){try{parent.postMessage({__ch:document.documentElement.scrollHeight,__id:${JSON.stringify(id)}},'*');}catch(e){}}
  window.addEventListener('load',post);
  if(window.ResizeObserver){try{new ResizeObserver(post).observe(document.documentElement);}catch(e){}}
  window.addEventListener('resize',post);
  setTimeout(post,300);setTimeout(post,1200);
})();</script>`;

export function SandboxedHtml({ html }: { html: string }) {
  const id = useMemo(() => 'sbx-' + Math.random().toString(36).slice(2), []);
  const [height, setHeight] = useState(420);
  const ref = useRef<HTMLIFrameElement>(null);

  const srcDoc = useMemo(() => {
    const snip = resizeSnippet(id);
    return html.includes('</body>') ? html.replace('</body>', snip + '</body>') : html + snip;
  }, [html, id]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Solo aceptar mensajes de ESTE iframe y con nuestro id (leemos únicamente un número).
      if (ref.current && e.source === ref.current.contentWindow && e.data && e.data.__id === id && typeof e.data.__ch === 'number') {
        setHeight(Math.min(Math.max(e.data.__ch, 120), 6000));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [id]);

  return (
    <iframe
      ref={ref}
      title="Contenido"
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      loading="lazy"
      className="w-full rounded-xl border border-slate-200 bg-white"
      style={{ height, maxHeight: 6000 }}
    />
  );
}
