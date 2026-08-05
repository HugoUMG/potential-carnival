import { useState, useMemo } from 'react';
import { Check, Copy, Download, ImageIcon, Loader2, Search, X } from 'lucide-react';
import libraryData from '../data/image-library.json';
import { MyImagesGrid } from '../components/ImagePicker';

type ImageEntry = {
  id: string;
  name: string;
  description: string;
  url: string;
  tags: string[];
  level: string;
  questions: string[];
};

type Category = {
  id: string;
  name: string;
  name_es: string;
  level: string;
  color: string;
  images: ImageEntry[];
};

const ALL_ID = '__all__';

/** Comprueba que la URL siga viva (HEAD; si el CDN rechaza HEAD, GET). Sin esto, una imagen que el
 *  alumno ve como "no disponible" pasa el check porque el `<img>` no dispara `onError`. */
async function urlIsAlive(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (head.ok) return true;
  } catch { /* el CDN puede no servir HEAD → probamos GET */ }
  try {
    const get = await fetch(url, { method: 'GET', cache: 'no-store' });
    return get.ok;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<boolean>): Promise<boolean[]> {
  const results = new Array<boolean>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Reemplaza las entradas rotas por la imagen sana más parecida (misma categoría y etiquetas en
 *  común); la entrada rota conserva su id y adopta el contenido de la candidata, y la candidata
 *  deja de existir por separado (así no hay duplicados ni huecos). Devuelve el JSON reparado. */
function repairLibrary(data: typeof libraryData, deadIds: Set<string>): { data: typeof libraryData; replaced: number; stillBroken: Set<string> } {
  const cats = data.categories as Category[];
  const stillBroken = new Set<string>();
  let replaced = 0;

  const find = (id: string): { cat: Category; img: ImageEntry } | null => {
    for (const cat of cats) {
      const img = cat.images.find((i) => i.id === id);
      if (img) return { cat, img };
    }
    return null;
  };

  for (const deadId of deadIds) {
    const broken = find(deadId);
    if (!broken) continue;
    let best: { cat: Category; img: ImageEntry } | null = null;
    let bestScore = -1;
    for (const cat of cats) {
      for (const img of cat.images) {
        if (img.id === deadId) continue;
        let score = 0;
        if (cat === broken.cat) score += 5;
        score += img.tags.filter((t) => broken.img.tags.includes(t)).length * 2;
        const words = new Set((broken.img.name + ' ' + broken.img.description).toLowerCase().split(/\W+/).filter(Boolean));
        score += (img.name + ' ' + img.description).toLowerCase().split(/\W+/).filter((w) => words.has(w)).length;
        if (score > bestScore) { bestScore = score; best = { cat, img }; }
      }
    }
    if (best) {
      Object.assign(broken.img, best.img, { id: broken.img.id });
      best.cat.images = best.cat.images.filter((i) => i.id !== best.img.id);
      replaced++;
    } else {
      stillBroken.add(deadId);
    }
  }
  return { data, replaced, stillBroken };
}

export function ImageLibraryPage() {
  const [tab, setTab] = useState<'gratis' | 'mia'>('gratis');
  const [selectedCategory, setSelectedCategory] = useState(ALL_ID);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageEntry | null>(null);
  const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set());
  const [libData, setLibData] = useState<typeof libraryData>(libraryData);
  const [checking, setChecking] = useState(false);
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const [repairSummary, setRepairSummary] = useState<string | null>(null);

  const categories = libData.categories as Category[];

  const allImages: (ImageEntry & { categoryName: string; categoryColor: string })[] = useMemo(
    () =>
      categories.flatMap((cat) =>
        cat.images.map((img) => ({ ...img, categoryName: cat.name, categoryColor: cat.color })),
      ),
    [categories],
  );

  const filteredImages = useMemo(() => {
    const q = search.toLowerCase().trim();
    const cat = categories.find((c) => c.id === selectedCategory);
    const pool = selectedCategory === ALL_ID
      ? allImages
      : (cat?.images ?? []).map((img) => ({ ...img, categoryName: cat!.name, categoryColor: cat!.color }));
    if (!q) return pool;
    return pool.filter(
      (img) =>
        img.name.toLowerCase().includes(q) ||
        img.description.toLowerCase().includes(q) ||
        img.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [selectedCategory, search, allImages, categories]);

  function copyUrl(img: { id: string; url: string }) {
    void navigator.clipboard.writeText(img.url).then(() => {
      setCopiedId(img.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(libData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'image-library.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Verifica los enlaces de TODA la biblioteca y reemplaza los rotos por la imagen sana más
   *  parecida. El JSON resultante vive en memoria: se descarga con "Descargar JSON" y se vuelve a
   *  poner en `src/data/image-library.json`. */
  async function checkAndRepairLibrary() {
    setChecking(true);
    setRepairSummary(null);
    setBrokenImages(new Set());
    const all = libData.categories as Category[];
    const flat = all.flatMap((cat) => cat.images.map((img) => ({ cat, img })));
    setCheckProgress({ done: 0, total: flat.length });
    let done = 0;
    const alive = await mapWithConcurrency(flat, 6, async (entry) => {
      const ok = await urlIsAlive(entry.img.url);
      done++;
      setCheckProgress({ done, total: flat.length });
      return ok;
    });
    const deadIds = new Set(flat.filter((_, i) => !alive[i]).map((entry) => entry.img.id));
    let replaced = 0;
    let stillBroken: Set<string> = new Set();
    if (deadIds.size > 0) {
      const repaired = repairLibrary(JSON.parse(JSON.stringify(libData)) as typeof libraryData, deadIds);
      setLibData(repaired.data);
      replaced = repaired.replaced;
      stillBroken = repaired.stillBroken;
      setBrokenImages(stillBroken);
    }
    setCheckProgress(null);
    setChecking(false);
    setRepairSummary(
      deadIds.size === 0
        ? `✓ Los ${flat.length} enlaces están activos. La biblioteca no necesita reparación.`
        : `Verificadas ${flat.length} imágenes · ${deadIds.size} rota(s) · ${replaced} reemplazada(s) con la más parecida`
          + (stillBroken.size > 0 ? ` · ${stillBroken.size} sin parecida, quedaron marcadas` : '')
          + '. Descarga el JSON reparado y sustitúyelo en src/data/image-library.json.',
    );
  }

  function levelColor(level: string) {
    if (level === 'A1') return 'bg-emerald-100 text-emerald-700';
    if (level === 'A2') return 'bg-blue-100 text-blue-700';
    if (level === 'B1') return 'bg-violet-100 text-violet-700';
    return 'bg-amber-100 text-amber-700';
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-violet-100 text-violet-700">
            <ImageIcon size={20} />
          </span>
          <div>
            <h2 className="text-2xl font-bold">Biblioteca de Imágenes</h2>
            <p className="text-sm text-slate-500">
              {tab === 'gratis'
                ? `${libraryData.meta.total_images} imágenes • ${categories.length} categorías`
                : 'Tus imágenes subidas'} • para actividad <code className="rounded bg-slate-100 px-1">imagequestion</code>
            </p>
          </div>
        </div>
        {tab === 'gratis' && (
          <div className="flex flex-wrap gap-2">
            <button
              className="flex items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-60"
              onClick={() => void checkAndRepairLibrary()}
              disabled={checking}
              title="Revisa que todos los enlaces sigan activos y reemplaza los rotos por la imagen más parecida de la biblioteca"
            >
              {checking ? <><Loader2 size={15} className="animate-spin" /> Verificando…</> : <><Check size={15} /> Verificar enlaces</>}
            </button>
            <button
              className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              onClick={downloadJson}
              title="Descargar el JSON actual (el reparado, si acabas de verificar)"
            >
              <Download size={15} /> Descargar JSON
            </button>
          </div>
        )}
      </div>

      {checkProgress && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Verificando enlaces… {checkProgress.done}/{checkProgress.total}
        </p>
      )}
      {repairSummary && (
        <p className="mt-3 rounded-2xl bg-violet-50 px-4 py-3 text-sm text-violet-800">{repairSummary}</p>
      )}

      {/* Sub-pestañas: la gratuita (JSON estático) y la personal (persistida en BD) */}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'gratis' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          onClick={() => setTab('gratis')}
        >
          Gratuita
        </button>
        <button
          type="button"
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${tab === 'mia' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          onClick={() => setTab('mia')}
        >
          Mía
        </button>
      </div>

      {tab === 'mia' ? (
        <div className="mt-4">
          <MyImagesGrid />
        </div>
      ) : (
        <>
      <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>¿Cómo usar?</strong> Haz clic en <strong>Copiar URL</strong> y pégala en el campo <code>image:</code> de tu actividad DSL. Si una imagen no carga o su enlace murió, usa <strong>Verificar enlaces</strong>: revisa toda la biblioteca y reemplaza las rotas por la más parecida; luego descarga el JSON reparado y sustitúyelo en <code>src/data/image-library.json</code>.
      </p>

      {/* Search */}
      <div className="relative mt-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          className="w-full rounded-2xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          placeholder="Buscar por nombre, descripción o etiqueta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" onClick={() => setSearch('')}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Category tabs */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${selectedCategory === ALL_ID ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          onClick={() => setSelectedCategory(ALL_ID)}
        >
          Todas ({allImages.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${selectedCategory === cat.id ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            style={selectedCategory === cat.id ? { backgroundColor: cat.color } : undefined}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.name} ({cat.images.length})
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="mt-3 text-sm text-slate-500">{filteredImages.length} imágenes encontradas</p>

      {/* Grid */}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredImages.map((img) => (
          <div key={img.id} className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 hover:border-violet-200 hover:shadow-md transition-all">
            {/* Thumbnail */}
            <div className="relative h-44 overflow-hidden bg-slate-200">
              {brokenImages.has(img.id) ? (
                <div className="flex h-full items-center justify-center text-slate-400 flex-col gap-2">
                  <ImageIcon size={32} />
                  <span className="text-xs">Imagen no disponible</span>
                </div>
              ) : (
                <img
                  src={img.url.replace('w=800', 'w=400')}
                  alt={img.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                  onError={() => setBrokenImages((prev) => new Set([...prev, img.id]))}
                />
              )}
              {/* Level badge */}
              <span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-xs font-bold ${levelColor(img.level)}`}>
                {img.level}
              </span>
              {/* View full image button */}
              <button
                className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors"
                onClick={() => setSelectedImage(img)}
                title="Ver imagen completa"
              />
            </div>

            {/* Info */}
            <div className="p-3">
              <p className="font-semibold text-slate-900 text-sm leading-tight">{img.name}</p>
              <p className="mt-1 text-xs text-slate-500 line-clamp-2">{img.description}</p>

              {/* Tags */}
              <div className="mt-2 flex flex-wrap gap-1">
                {img.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {tag}
                  </span>
                ))}
              </div>

              {/* Copy URL button */}
              <button
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition-colors ${copiedId === img.id ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                onClick={() => copyUrl(img)}
              >
                {copiedId === img.id ? <><Check size={14} /> ¡Copiado!</> : <><Copy size={14} /> Copiar URL</>}
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredImages.length === 0 && (
        <div className="mt-8 rounded-2xl bg-slate-50 p-8 text-center text-slate-500">
          No se encontraron imágenes para "{search}"
        </div>
      )}

      {/* Image detail modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
              onClick={() => setSelectedImage(null)}
            >
              <X size={16} />
            </button>

            <img
              src={selectedImage.url}
              alt={selectedImage.name}
              className="mx-auto block max-w-full rounded-2xl"
              style={{ maxHeight: '360px' }}
            />

            <div className="mt-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xl font-bold">{selectedImage.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${levelColor(selectedImage.level)}`}>
                  {selectedImage.level}
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">{selectedImage.description}</p>

              <div className="mt-3 flex flex-wrap gap-1">
                {selectedImage.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {tag}
                  </span>
                ))}
              </div>

              {selectedImage.questions.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-semibold text-slate-700">Preguntas sugeridas:</p>
                  <ul className="grid gap-1">
                    {selectedImage.questions.map((q, i) => (
                      <li key={i} className="flex gap-2 rounded-xl bg-violet-50 px-3 py-2 text-sm text-violet-800">
                        <span className="font-bold shrink-0">{i + 1}.</span> {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 rounded-xl bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">URL</p>
                <p className="break-all text-xs text-slate-700 font-mono">{selectedImage.url}</p>
              </div>

              <button
                className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold transition-colors ${copiedId === selectedImage.id ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                onClick={() => copyUrl(selectedImage)}
              >
                {copiedId === selectedImage.id ? <><Check size={16} /> ¡URL copiada!</> : <><Copy size={16} /> Copiar URL para DSL</>}
              </button>

              <div className="mt-3 rounded-xl bg-slate-800 p-3">
                <p className="mb-1 text-xs font-semibold text-slate-400">Ejemplo de uso en DSL:</p>
                <pre className="text-xs text-emerald-400 whitespace-pre-wrap">
{`imagequestion {
  image: "${selectedImage.url}"
  question: "${selectedImage.questions[0] ?? 'Describe what you see in the picture.'}"
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </section>
  );
}
