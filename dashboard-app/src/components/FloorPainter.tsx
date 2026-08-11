import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Eraser, Brush, Undo2, Trash2, Wand2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

// Marcador de superficie sobre la foto (mobile-first, dedo o mouse). Fuente de verdad: una máscara
// raster b/n (blanco = zona a repintar) al tamaño nativo de la foto. Se puede SEMBRAR con la
// auto-detección (grounded_sam) y retocar con pincel/borrador. Exporta la máscara para el inpaint.

type Pt = { x: number; y: number }
export type FloorPainterHandle = { getMask: () => string | null }

export const FloorPainter = forwardRef<FloorPainterHandle, {
  src: string
  surfaceLabel?: string                      // "piso" | "pared" (para el botón Detectar)
  onAutoDetect?: () => Promise<string | null> // devuelve una máscara b/n (dataURL) o null
}>(function FloorPainter({ src, surfaceLabel = "piso", onAutoDetect }, ref) {
  const imgRef = useRef<HTMLImageElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)     // visible: rojo translúcido
  const maskRef = useRef<HTMLCanvasElement | null>(null) // offscreen: b/n (verdad)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [brush, setBrush] = useState(56)
  const [erase, setErase] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [, force] = useState(0)              // re-render para habilitar botones
  const history = useRef<ImageData[]>([])
  const last = useRef<Pt | null>(null)
  const painting = useRef(false)

  function onImgLoad() {
    const img = imgRef.current!
    const w = img.naturalWidth, h = img.naturalHeight
    const m = document.createElement("canvas"); m.width = w; m.height = h
    const mc = m.getContext("2d")!; mc.fillStyle = "#000"; mc.fillRect(0, 0, w, h)
    maskRef.current = m
    history.current = []
    setDims({ w, h })
  }
  useEffect(() => { if (dims) clearOverlay() }, [dims])

  const maskCtx = () => maskRef.current!.getContext("2d")!
  const overCtx = () => overlayRef.current!.getContext("2d")!
  function clearOverlay() { const c = overlayRef.current!; overCtx().clearRect(0, 0, c.width, c.height) }

  // Rearma el overlay rojo a partir de la máscara (blanco → rojo translúcido). Uso: seed / undo.
  function renderOverlayFromMask() {
    const m = maskRef.current!, o = overlayRef.current!
    const md = maskCtx().getImageData(0, 0, m.width, m.height)
    const od = overCtx().createImageData(o.width, o.height)
    for (let i = 0; i < md.data.length; i += 4) {
      if (md.data[i] > 128) { od.data[i] = 244; od.data[i + 1] = 63; od.data[i + 2] = 94; od.data[i + 3] = 128 }
    }
    overCtx().putImageData(od, 0, 0)
  }

  function pushHistory() {
    const m = maskRef.current!; if (!m) return
    history.current.push(maskCtx().getImageData(0, 0, m.width, m.height))
    if (history.current.length > 12) history.current.shift()
    force((n) => n + 1)
  }

  // dibuja un segmento en máscara (blanco/negro) y overlay (rojo / borrar)
  function drawSeg(a: Pt, b: Pt) {
    const s = brush
    const mc = maskCtx(); mc.lineWidth = s; mc.lineCap = "round"; mc.lineJoin = "round"
    mc.strokeStyle = erase ? "#000" : "#fff"; mc.fillStyle = mc.strokeStyle
    mc.beginPath(); mc.moveTo(a.x, a.y); mc.lineTo(b.x, b.y); mc.stroke()
    mc.beginPath(); mc.arc(b.x, b.y, s / 2, 0, Math.PI * 2); mc.fill()
    const oc = overCtx(); oc.save()
    oc.lineWidth = s; oc.lineCap = "round"; oc.lineJoin = "round"
    if (erase) { oc.globalCompositeOperation = "destination-out"; oc.strokeStyle = "#000"; oc.fillStyle = "#000" }
    else { oc.strokeStyle = "rgba(244,63,94,0.5)"; oc.fillStyle = "rgba(244,63,94,0.5)" }
    oc.beginPath(); oc.moveTo(a.x, a.y); oc.lineTo(b.x, b.y); oc.stroke()
    oc.beginPath(); oc.arc(b.x, b.y, s / 2, 0, Math.PI * 2); oc.fill(); oc.restore()
  }

  function toNative(e: React.PointerEvent): Pt {
    const c = overlayRef.current!, r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  function down(e: React.PointerEvent) {
    e.preventDefault(); overlayRef.current?.setPointerCapture(e.pointerId)
    pushHistory(); painting.current = true
    const p = toNative(e); last.current = p; drawSeg(p, p)
  }
  function move(e: React.PointerEvent) {
    if (!painting.current) return
    const p = toNative(e); drawSeg(last.current!, p); last.current = p
  }
  function up() { painting.current = false; last.current = null }

  function undo() {
    const prev = history.current.pop(); if (!prev) return
    maskCtx().putImageData(prev, 0, 0); renderOverlayFromMask(); force((n) => n + 1)
  }
  function clearAll() {
    pushHistory()
    const m = maskRef.current!; const mc = maskCtx(); mc.fillStyle = "#000"; mc.fillRect(0, 0, m.width, m.height)
    clearOverlay(); force((n) => n + 1)
  }
  async function autoDetect() {
    if (!onAutoDetect) return
    setDetecting(true)
    try {
      const url = await onAutoDetect()
      if (!url) return
      await new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => {
          pushHistory()
          const m = maskRef.current!, mc = maskCtx()
          mc.fillStyle = "#000"; mc.fillRect(0, 0, m.width, m.height)
          mc.drawImage(img, 0, 0, m.width, m.height)
          renderOverlayFromMask(); resolve()
        }
        img.onerror = () => resolve()
        img.src = url
      })
    } finally { setDetecting(false) }
  }

  useImperativeHandle(ref, () => ({
    getMask: () => {
      const m = maskRef.current; if (!m) return null
      // ¿hay algo pintado? (evita mandar una máscara toda negra)
      const d = maskCtx().getImageData(0, 0, m.width, m.height).data
      for (let i = 0; i < d.length; i += 4) if (d[i] > 128) return m.toDataURL("image/png")
      return null
    },
  }), [dims])

  return (
    <div className="space-y-2">
      <div className="relative inline-block w-full leading-[0] select-none">
        <img ref={imgRef} src={src} onLoad={onImgLoad} alt="ambiente" className="w-full rounded-lg border block" draggable={false} />
        {dims && (
          <canvas ref={overlayRef} width={dims.w} height={dims.h}
            className="absolute inset-0 w-full h-full rounded-lg touch-none cursor-crosshair"
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onAutoDetect && (
          <Button type="button" size="sm" variant="secondary" onClick={autoDetect} disabled={detecting}>
            {detecting ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Detectando…</> : <><Wand2 className="h-4 w-4 mr-1" /> Detectar {surfaceLabel}</>}
          </Button>
        )}
        <Button type="button" size="sm" variant={erase ? "outline" : "default"} onClick={() => setErase(false)}>
          <Brush className="h-4 w-4 mr-1" /> Pintar
        </Button>
        <Button type="button" size="sm" variant={erase ? "default" : "outline"} onClick={() => setErase(true)}>
          <Eraser className="h-4 w-4 mr-1" /> Borrar
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
          Pincel
          <input type="range" min={20} max={140} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="w-20" />
        </label>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={undo} disabled={!history.current.length}>
            <Undo2 className="h-4 w-4 mr-1" /> Deshacer
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
            <Trash2 className="h-4 w-4 mr-1" /> Limpiar
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Tocá <b>Detectar {surfaceLabel}</b> para un arranque automático y retocá con el dedo, o pintá directamente. Con <b>Borrar</b> corregís.
      </p>
    </div>
  )
})
