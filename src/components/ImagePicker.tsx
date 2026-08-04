/**
 * Biblioteca personal de imágenes del profesor (persistida en BD) y el modal que la combina
 * con la biblioteca gratuita para elegir una imagen sin salir del editor de actividades.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ImageIcon, Loader2, Search, Trash2, Upload, X } from 'lucide-react';
import libraryData from '../data/image-library.json';
import { subirImagen, listarMisImagenes, registrarImagen, borrarMiImagen, type MiImagen } from '../services/api';

type FreeImageEntry = { id: string; name: string; url: string; tags: string[] };
type FreeCategory = { images: FreeImageEntry[] };
const FREE_IMAGES = (libraryData.categories as FreeCategory[]).flatMap((c) => c.images);

/**
 * ponytail: grilla con solo búsqueda, sin categorías ni vista de detalle (esas viven en
 * ImageLibraryPage) — en un modal el objetivo es elegir rápido, no explorar la biblioteca.
 */
export function FreeImagePicker({ onSelect }: { onSelect: (url: string) => void }) {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase().trim();
  const results = q
    ? FREE_IMAGES.filter((img) => img.name.toLowerCase().includes(q) || img.tags.some((t) => t.toLowerCase().includes(q)))
    : FREE_IMAGES;

  return (
    <div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          className="w-full rounded-2xl border border-slate-200 py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
          placeholder="Buscar por nombre o etiqueta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="mt-3 grid max-h-96 grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
        {results.map((img) => (
          <button
            key={img.id}
            type="button"
            className="group relative h-24 overflow-hidden rounded-xl border border-slate-100 bg-slate-100 hover:border-violet-300"
            onClick={() => onSelect(img.url)}
            title={img.name}
          >
            <img src={img.url.replace('w=800', 'w=300')} alt={img.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
          </button>
        ))}
      </div>
      {results.length === 0 && <p className="mt-6 text-center text-sm text-slate-500">Sin resultados para "{search}"</p>}
    </div>
  );
}

/**
 * Con `onSelect`, además de administrar (subir/copiar/borrar) hace de selector: clic en la
 * imagen la elige. Sin él (página completa), el clic no hace nada — solo copiar/borrar.
 */
export function MyImagesGrid({ onSelect }: { onSelect?: (url: string) => void }) {
  const [images, setImages] = useState<MiImagen[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listarMisImagenes()
      .then(setImages)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar tu biblioteca.'));
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url, public_id } = await subirImagen(file);
      const saved = await registrarImagen(public_id, url);
      setImages((prev) => [saved, ...(prev ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la imagen.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = ''; // permite re-subir el mismo archivo
    }
  }

  async function remove(image: MiImagen) {
    if (!window.confirm('¿Borrar esta imagen de tu biblioteca? No afecta a las hojas ya guardadas.')) return;
    setDeletingId(image.id);
    try {
      await borrarMiImagen(image.id);
      setImages((prev) => (prev ?? []).filter((i) => i.id !== image.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar la imagen.');
    } finally {
      setDeletingId(null);
    }
  }

  function copyUrl(image: MiImagen) {
    void navigator.clipboard.writeText(image.url).then(() => {
      setCopiedId(image.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
      <button
        type="button"
        className="flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
        onClick={() => fileInput.current?.click()}
        disabled={uploading}
      >
        {uploading ? <><Loader2 size={15} className="animate-spin" /> Subiendo…</> : <><Upload size={15} /> Subir imagen</>}
      </button>

      {error && <p className="mt-3 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

      {images === null ? (
        <p className="mt-6 text-center text-sm text-slate-500">Cargando tu biblioteca…</p>
      ) : images.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-slate-50 p-8 text-center text-slate-500">
          <ImageIcon size={28} className="mx-auto mb-2 text-slate-300" />
          Todavía no has subido ninguna imagen.
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50 hover:border-violet-200 hover:shadow-md transition-all">
              <button
                type="button"
                className="block h-44 w-full overflow-hidden bg-slate-200 disabled:cursor-default"
                onClick={() => onSelect?.(img.url)}
                disabled={!onSelect}
                title={onSelect ? 'Usar esta imagen' : undefined}
              >
                <img src={img.url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
              </button>
              <div className="flex gap-2 p-3">
                <button
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${copiedId === img.id ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                  onClick={() => copyUrl(img)}
                >
                  {copiedId === img.id ? <><Check size={14} /> ¡Copiado!</> : <><Copy size={14} /> Copiar</>}
                </button>
                <button
                  className="flex items-center justify-center rounded-xl border border-rose-200 px-3 text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                  onClick={() => remove(img)}
                  disabled={deletingId === img.id}
                  title="Borrar"
                >
                  {deletingId === img.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Modal con las dos bibliotecas (gratuita | mía) para elegir una imagen sin salir del editor. */
export function ImagePickerModal({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'gratis' | 'mia'>('gratis');

  function pick(url: string) {
    onSelect(url);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={onClose}>
          <X size={16} />
        </button>
        <h3 className="text-lg font-bold">Elegir imagen</h3>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${tab === 'gratis' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            onClick={() => setTab('gratis')}
          >
            Gratuita
          </button>
          <button
            type="button"
            className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-colors ${tab === 'mia' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            onClick={() => setTab('mia')}
          >
            Mía
          </button>
        </div>
        <div className="mt-4">
          {tab === 'gratis' ? <FreeImagePicker onSelect={pick} /> : <MyImagesGrid onSelect={pick} />}
        </div>
      </div>
    </div>
  );
}
