import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Eraser, Brush, Undo2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

// Pincel para marcar el piso sobre la foto (mobile-first, dedo o mouse). Exporta una máscara
// blanco/negro (blanco = zona pintada = a repintar) del tamaño nativo de la foto, para el inpaint.
// El vendedor sombrea el piso; no hace falta precisión de píxel (el inpaint respeta bordes).

type Pt = { x: number; y: number }
type Stroke = { size: number; erase: boolean; pts: Pt[] }
export type FloorPainterHandle = { getMask: () => string | null; hasPaint: () => boolean }

export const FloorPainter = forwardRef<FloorPainterHandle, { src: string }>(function FloorPainter({ src }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null) // tamaño nativo de la foto
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [brush, setBrush] = useState(48)
  const [erase, setErase] = useState(false)
  const drawing = useRef<Stroke | null>(null)

  // Al cargar la imagen, fijamos el canvas al tamaño NATIVO (para exportar la máscara a esa resolución).
  function onImgLoad() {
    const img = imgRef.current!
    setDims({ w: img.naturalWidth, h: img.naturalHeight })
  }

  // Redibuja el overlay rojo translúcido a partir de los trazos (paint = rojo, erase = borra).
  function redraw(all: Stroke[]) {
    const c = overlayRef.current; if (!c) return
    const ctx = c.getContext("2d")!; ctx.clearRect(0, 0, c.width, c.height)
    for (const s of all) drawStroke(ctx, s, s.erase ? "erase-overlay" : "paint-overlay")
  }
  function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, mode: "paint-overlay" | "erase-overlay" | "mask" ) {
    if (s.pts.length === 0) return
    ctx.save()
    ctx.lineWidth = s.size; ctx.lineCap = "round"; ctx.lineJoin = "round"
    if (mode === "erase-overlay") { ctx.globalCompositeOperation = "destination-out"; ctx.strokeStyle = "rgba(0,0,0,1)"; ctx.fillStyle = "rgba(0,0,0,1)" }
    else if (mode === "paint-overlay") { ctx.strokeStyle = "rgba(244,63,94,0.5)"; ctx.fillStyle = "rgba(244,63,94,0.5)" }
    else { ctx.strokeStyle = s.erase ? "#000" : "#fff"; ctx.fillStyle = s.erase ? "#000" : "#fff" } // máscara b/n
    ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y)
    for (const p of s.pts) ctx.lineTo(p.x, p.y)
    ctx.stroke()
    // punto inicial (para taps sin arrastre)
    ctx.beginPath(); ctx.arc(s.pts[0].x, s.pts[0].y, s.size / 2, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }

  useEffect(() => { redraw(strokes) }, [strokes, dims])

  // pointer → coords nativas de la foto
  function toNative(e: React.PointerEvent): Pt {
    const c = overlayRef.current!, r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  function down(e: React.PointerEvent) {
    e.preventDefault(); overlayRef.current?.setPointerCapture(e.pointerId)
    drawing.current = { size: brush, erase, pts: [toNative(e)] }
    setStrokes((s) => [...s, drawing.current!])
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    drawing.current.pts.push(toNative(e))
    setStrokes((s) => [...s.slice(0, -1), { ...drawing.current! }])
  }
  function up() { drawing.current = null }

  useImperativeHandle(ref, () => ({
    hasPaint: () => strokes.some((s) => !s.erase),
    getMask: () => {
      if (!dims || !strokes.some((s) => !s.erase)) return null
      const m = document.createElement("canvas"); m.width = dims.w; m.height = dims.h
      const ctx = m.getContext("2d")!; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, m.width, m.height)
      for (const s of strokes) drawStroke(ctx, s, "mask")
      return m.toDataURL("image/png")
    },
  }), [strokes, dims])

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative inline-block w-full leading-[0] select-none">
        <img ref={imgRef} src={src} onLoad={onImgLoad} alt="ambiente" className="w-full rounded-lg border block" draggable={false} />
        {dims && (
          <canvas
            ref={overlayRef} width={dims.w} height={dims.h}
            className="absolute inset-0 w-full h-full rounded-lg touch-none cursor-crosshair"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={erase ? "outline" : "default"} onClick={() => setErase(false)}>
          <Brush className="h-4 w-4 mr-1" /> Pintar
        </Button>
        <Button type="button" size="sm" variant={erase ? "default" : "outline"} onClick={() => setErase(true)}>
          <Eraser className="h-4 w-4 mr-1" /> Borrar
        </Button>
        <label className="flex items-center gap-2 text-xs text-muted-foreground ml-1">
          Pincel
          <input type="range" min={16} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="w-24" />
        </label>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
            <Undo2 className="h-4 w-4 mr-1" /> Deshacer
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setStrokes([])} disabled={!strokes.length}>
            <Trash2 className="h-4 w-4 mr-1" /> Limpiar
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Sombreá el piso con el dedo (no hace falta precisión). Con “Borrar” corregís si te pasaste.</p>
    </div>
  )
})
