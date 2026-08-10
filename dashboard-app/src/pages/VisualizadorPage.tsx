import { useEffect, useRef, useState } from "react"
import { Camera, Wand2, Loader2, Share2, RotateCcw, ImageOff } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { getJSON } from "@/lib/api"

// Visualizador de Ambientes (spike): el vendedor saca una foto del ambiente del cliente,
// elige un diseño del catálogo y el modelo (Gemini) genera cómo quedaría. Mobile-first.

type Superficie = "piso" | "pared" | "ambos"
type Design = {
  id: string; nombre: string; superficie: "piso" | "pared"
  marca: string; coleccion: string; tono: string; muestra: string
}
type Catalogo = { configured: boolean; designs: Design[] }

// Redimensiona/comprime la foto client-side (canvas) a máx `max` px lado mayor → JPEG base64.
// Evita subir 8 MB de la cámara y mantiene el request bajo el límite del server.
async function fotoADataUrl(file: File, max = 1568, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement("canvas")
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL("image/jpeg", quality)
}

const SURFACES: { value: Superficie; label: string }[] = [
  { value: "piso", label: "Piso" },
  { value: "pared", label: "Pared" },
  { value: "ambos", label: "Piso + Pared" },
]

export default function VisualizadorPage() {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null)
  const [superficie, setSuperficie] = useState<Superficie>("piso")
  const [foto, setFoto] = useState<string | null>(null)      // data URL de la foto del ambiente
  const [pisoId, setPisoId] = useState<string | null>(null)
  const [paredId, setParedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [render, setRender] = useState<{ imagen: string; ms: number; modelo: string } | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)     // toggle antes/después
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getJSON<Catalogo>("/api/visualizador/catalogo")
      .then(setCatalogo)
      .catch((e) => setError(e.message || "no se pudo cargar el catálogo"))
  }, [])

  const pisos = catalogo?.designs.filter((d) => d.superficie === "piso") ?? []
  const paredes = catalogo?.designs.filter((d) => d.superficie === "pared") ?? []
  const needPiso = superficie === "piso" || superficie === "ambos"
  const needPared = superficie === "pared" || superficie === "ambos"
  const ready = !!foto && (!needPiso || !!pisoId) && (!needPared || !!paredId)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setRender(null)
    try { setFoto(await fotoADataUrl(file)) }
    catch { setError("no se pudo leer la foto") }
    e.target.value = "" // permite re-elegir la misma foto
  }

  async function generar() {
    if (!ready || !foto) return
    setLoading(true); setError(null); setRender(null); setShowOriginal(false)
    try {
      const r = await fetch("/api/visualizador/render", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          foto,
          superficie,
          productoId: needPiso ? pisoId : paredId, // piso o pared según superficie
          ...(superficie === "ambos" ? { productoId: pisoId, productoParedId: paredId } : {}),
        }),
      })
      const data = await r.json().catch(() => null)
      if (!r.ok || !data?.ok) throw new Error(data?.error || `error ${r.status}`)
      setRender({ imagen: data.imagen, ms: data.ms, modelo: data.modelo })
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo generar el render")
    } finally {
      setLoading(false)
    }
  }

  async function compartir() {
    if (!render) return
    try {
      const blob = await (await fetch(render.imagen)).blob()
      const file = new File([blob], "ambiente-pacific.jpg", { type: blob.type || "image/jpeg" })
      // Web Share con archivos (móvil): abre WhatsApp/Mail/etc. Debe correr dentro del gesto del tap.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Pisos Pacific" })
        return
      }
    } catch { /* usuario canceló o no soportado → cae a descarga */ }
    const a = document.createElement("a")
    a.href = render.imagen; a.download = "ambiente-pacific.jpg"; a.click()
  }

  function reset() {
    setFoto(null); setRender(null); setError(null); setPisoId(null); setParedId(null)
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Wand2 className="h-5 w-5" /> Visualizador de Ambientes
        </h1>
        <p className="text-sm text-muted-foreground">
          Sacá una foto del ambiente del cliente y mostrale cómo queda con un diseño Pacific / AcuDesign.
        </p>
      </header>

      {catalogo && !catalogo.configured && (
        <Card className="p-3 text-sm bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠️ Falta configurar <code>GEMINI_API_KEY</code> en el servidor — el render no va a funcionar hasta cargarla.
        </Card>
      )}

      {/* 1 · Foto */}
      <section className="space-y-2">
        <div className="text-sm font-medium">1 · Foto del ambiente</div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        {foto ? (
          <div className="relative">
            <img src={foto} alt="ambiente" className="w-full rounded-lg border object-cover max-h-72" />
            <Button size="sm" variant="secondary" className="absolute top-2 right-2" onClick={() => fileRef.current?.click()}>
              <Camera className="h-4 w-4 mr-1" /> Cambiar
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="w-full h-28 border-dashed" onClick={() => fileRef.current?.click()}>
            <Camera className="h-5 w-5 mr-2" /> Sacar o elegir foto
          </Button>
        )}
      </section>

      {/* 2 · Superficie */}
      <section className="space-y-2">
        <div className="text-sm font-medium">2 · Qué reemplazar</div>
        <div className="grid grid-cols-3 gap-2">
          {SURFACES.map((s) => (
            <Button key={s.value} variant={superficie === s.value ? "default" : "outline"}
              onClick={() => { setSuperficie(s.value); setRender(null) }}>
              {s.label}
            </Button>
          ))}
        </div>
      </section>

      {/* 3 · Diseños */}
      <section className="space-y-3">
        <div className="text-sm font-medium">3 · Elegí el diseño</div>
        {needPiso && (
          <DesignGrid title="Piso (Pacific)" designs={pisos} selected={pisoId} onSelect={setPisoId} />
        )}
        {needPared && (
          <DesignGrid title="Pared (AcuDesign)" designs={paredes} selected={paredId} onSelect={setParedId} />
        )}
      </section>

      {/* 4 · Generar — sticky abajo para que en el celular siempre esté a mano (one-handed). */}
      <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-gradient-to-t from-background via-background to-transparent">
        <Button className="w-full h-14 text-base shadow-lg" disabled={!ready || loading} onClick={generar}>
          {loading ? <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Generando… (~10–20 s)</> : <><Wand2 className="h-5 w-5 mr-2" /> Generar</>}
        </Button>
        {!ready && !loading && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {!foto ? "Falta la foto" : "Elegí un diseño"}
          </p>
        )}
      </div>

      {error && (
        <Card className="p-3 text-sm bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200">{error}</Card>
      )}

      {/* 5 · Resultado + comparador */}
      {render && foto && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Resultado</div>
            <div className="text-xs text-muted-foreground">{(render.ms / 1000).toFixed(1)} s · {render.modelo}</div>
          </div>
          <img src={showOriginal ? foto : render.imagen} alt="render" className="w-full rounded-lg border" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-12"
              onMouseDown={() => setShowOriginal(true)} onMouseUp={() => setShowOriginal(false)}
              onMouseLeave={() => setShowOriginal(false)} onTouchStart={() => setShowOriginal(true)} onTouchEnd={() => setShowOriginal(false)}>
              <RotateCcw className="h-4 w-4 mr-1" /> {showOriginal ? "Original" : "Ver original"}
            </Button>
            <Button className="h-12" onClick={compartir}>
              <Share2 className="h-4 w-4 mr-1" /> Compartir
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={reset}>Empezar de nuevo</Button>
        </section>
      )}
    </div>
  )
}

function DesignGrid({ title, designs, selected, onSelect }: {
  title: string; designs: Design[]; selected: string | null; onSelect: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="grid grid-cols-4 gap-2">
        {designs.length === 0 && (
          <div className="col-span-4 flex items-center gap-2 text-xs text-muted-foreground py-4">
            <ImageOff className="h-4 w-4" /> Sin diseños
          </div>
        )}
        {designs.map((d) => (
          <button key={d.id} onClick={() => onSelect(d.id)}
            className={`rounded-lg overflow-hidden border-2 text-left transition ${selected === d.id ? "border-primary ring-2 ring-primary/30" : "border-transparent hover:border-border"}`}>
            <img src={d.muestra} alt={d.nombre} className="aspect-square w-full object-cover" />
            <div className="px-1 py-1 text-[11px] leading-tight truncate">{d.nombre}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
