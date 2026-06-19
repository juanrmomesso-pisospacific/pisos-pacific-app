import { useEffect, useState } from "react"
import { Folder, ChevronRight, ImageOff, ExternalLink, Loader2, Images } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getJSON } from "@/lib/api"

type Crumb = { id: string; name: string }
type FolderData = { folders: { id: string; name: string }[]; images: { id: string; name: string }[]; others: { id: string; name: string }[] }

export default function GaleriaPage() {
  const [connected, setConnected] = useState<boolean | null>(null)
  const [stack, setStack] = useState<Crumb[]>([])
  const [data, setData] = useState<FolderData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Estado de conexión del Drive
  useEffect(() => {
    getJSON<{ connected: boolean; root: string }>("/api/drive/status")
      .then((s) => { setConnected(s.connected); setStack([{ id: s.root, name: "Banco de imágenes" }]) })
      .catch(() => setConnected(false))
  }, [])

  const current = stack[stack.length - 1]
  // Contenido de la carpeta actual
  useEffect(() => {
    if (!connected || !current) return
    let cancelled = false
    setLoading(true); setError(null)
    getJSON<FolderData>(`/api/drive/folder?id=${encodeURIComponent(current.id)}`)
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => {
        if (cancelled) return
        // Falla típica: el permiso de Drive todavía no se autorizó → mostrar el card de conexión.
        if (stack.length <= 1) setConnected(false)
        else setError(e?.message || "No se pudo cargar la carpeta")
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [connected, current?.id])

  if (connected === false) {
    return (
      <div className="px-4 lg:px-6">
        <Card className="max-w-md mx-auto mt-10 p-6 text-center space-y-3">
          <Images className="mx-auto h-6 w-6 text-muted-foreground" />
          <div className="text-sm text-muted-foreground">Hay que conectar (o reconectar) el Google Drive para ver el banco de imágenes.</div>
          <Button asChild><a href="/api/integrations/google/connect?account=pacific" target="_blank" rel="noreferrer">Conectar Google Drive</a></Button>
          <div className="text-[11px] text-muted-foreground">Te lleva a Google para dar permiso de <b>solo lectura</b> del Drive (sumado al de Gmail). Después volvé y <b>recargá</b> esta página.</div>
        </Card>
      </div>
    )
  }

  return (
    <div className="px-4 lg:px-6 space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 flex-wrap text-sm">
        {stack.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            <button onClick={() => setStack((s) => s.slice(0, i + 1))} className={i === stack.length - 1 ? "font-medium" : "text-muted-foreground hover:text-foreground"}>{c.name}</button>
          </span>
        ))}
      </div>

      {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</div>}
      {error && <Card className="p-4 text-sm text-destructive">{error}</Card>}

      {!loading && data && (
        <>
          {/* Subcarpetas */}
          {data.folders.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {data.folders.map((f) => (
                <button key={f.id} onClick={() => setStack((s) => [...s, { id: f.id, name: f.name }])}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2.5 text-left hover:bg-accent transition-colors">
                  <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                  <span className="text-sm truncate">{f.name}</span>
                </button>
              ))}
            </div>
          )}

          {/* Imágenes */}
          {data.images.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2">
              {data.images.map((img) => (
                <a key={img.id} href={`/api/drive/file/${img.id}`} target="_blank" rel="noreferrer" title={img.name}
                  className="group relative block aspect-square overflow-hidden rounded-md border border-border bg-muted">
                  <img src={`/api/drive/file/${img.id}`} alt={img.name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white truncate opacity-0 group-hover:opacity-100">{img.name}</span>
                  <ExternalLink className="absolute right-1 top-1 h-3.5 w-3.5 text-white opacity-0 group-hover:opacity-100 drop-shadow" />
                </a>
              ))}
            </div>
          ) : data.folders.length === 0 ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground py-12">
              <ImageOff className="h-6 w-6" />Esta carpeta no tiene imágenes.
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
