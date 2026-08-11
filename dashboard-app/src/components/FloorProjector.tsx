import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Button } from "@/components/ui/button"

// Proyecta la TEXTURA REAL del piso sobre el plano marcado, con perspectiva (homografía) y
// re-iluminación (luz/sombras de la foto). WebGL. El vendedor ajusta el marco del piso (4 puntos,
// auto-propuestos desde la máscara), la dirección y el tamaño de tabla. Devuelve el resultado.

export type FloorProjectorHandle = { getResult: () => string | null }
type Pt = { x: number; y: number }  // normalizados 0..1 (x/W, y/H), origen arriba-izq
type Dir = "vertical" | "horizontal" | "diagonal"

const VERT = `attribute vec2 p; varying vec2 uv; void main(){ uv=vec2((p.x+1.0)/2.0,(1.0-p.y)/2.0); gl_Position=vec4(p,0.0,1.0);} `
const FRAG = `
precision highp float;
varying vec2 uv;                 // posición en la imagen (0..1, y abajo)
uniform sampler2D uPhoto, uMask, uWood, uLum;
uniform mat3 uHinv;              // imagen -> plano textura (0..1)
uniform vec2 uRepeat;            // repeticiones (ancho, largo)
uniform float uBase;            // luminancia base del piso (para re-iluminar)
uniform int uDir;               // 0 vertical, 1 horizontal, 2 diagonal
float hash(float n){ return fract(sin(n*12.9898)*43758.5453); }
void main(){
  vec4 photo = texture2D(uPhoto, uv);
  float m = texture2D(uMask, uv).r;
  vec3 hp = uHinv * vec3(uv, 1.0);
  vec2 q = hp.xy / hp.z;                          // coords en el plano del piso (0..1 dentro del quad)
  float inside = (q.x>=0.0 && q.x<=1.0 && q.y>=0.0 && q.y<=1.0) ? 1.0 : 0.0;
  vec2 t = q;
  if(uDir==1) t = vec2(q.y, q.x);                 // tablas a lo ancho
  else if(uDir==2){ float c=0.7071; t = vec2((q.x+q.y)*c, (q.y-q.x)*c); } // diagonal
  vec2 tc = t * uRepeat;
  float col = floor(tc.x);                         // índice de tabla (columna)
  tc.y += hash(col);                               // desfase por tabla (rompe la repetición)
  vec2 wuv = fract(tc);
  vec3 wood = texture2D(uWood, wuv).rgb;
  // Re-iluminación SUAVE con luz DIFUSA (uLum = foto muy borroneada) → sombras/luz del ambiente,
  // NO la trama del piso original (eso evitaba el efecto "transparencia").
  float lum = dot(texture2D(uLum, uv).rgb, vec3(0.299,0.587,0.114));
  float shade = mix(1.0, clamp(lum / max(uBase, 0.02), 0.7, 1.35), 0.7);
  vec3 lit = clamp(wood * shade, 0.0, 1.0);
  float a = m * inside;
  gl_FragColor = vec4(mix(photo.rgb, lit, a), 1.0);
}`

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader")
  return s
}
// homografía cuadrado unitario -> quad (4 puntos). Devuelve la INVERSA (imagen->textura) como mat3 col-major.
function homographyInv(q: Pt[]): number[] {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]], dst = q.map((p) => [p.x, p.y])
  const A: number[][] = [], b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
  }
  const h = solve8(A, b)                          // h0..h7, h8=1  (textura->imagen)
  const H = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
  const Hi = invert3(H)                            // imagen->textura
  // a col-major para WebGL
  return [Hi[0], Hi[3], Hi[6], Hi[1], Hi[4], Hi[7], Hi[2], Hi[5], Hi[8]]
}
function solve8(A: number[][], b: number[]): number[] {
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
    ;[M[c], M[piv]] = [M[piv], M[c]]
    const d = M[c][c] || 1e-9
    for (let j = c; j <= 8; j++) M[c][j] /= d
    for (let r = 0; r < 8; r++) if (r !== c) { const f = M[r][c]; for (let j = c; j <= 8; j++) M[r][j] -= f * M[c][j] }
  }
  return M.map((r) => r[8])
}
function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C || 1e-9
  return [
    A / det, (c * h - b * i) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, (c * d - a * f) / det,
    C / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ]
}
function loadImg(src: string) { return new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = rej; i.src = src }) }

export const FloorProjector = forwardRef<FloorProjectorHandle, {
  photoSrc: string; maskSrc: string; textureUrl: string; plankMm?: number
}>(function FloorProjector({ photoSrc, maskSrc, textureUrl }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const glState = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; base: number } | null>(null)
  const [quad, setQuad] = useState<Pt[] | null>(null)
  const [dir, setDir] = useState<Dir>("vertical")
  const [size, setSize] = useState(50)          // 0..100 → tamaño de tabla (más = tablas más chicas)
  const [ready, setReady] = useState(false)
  const drag = useRef<number | null>(null)

  // setup WebGL + texturas + auto-quad
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [photo, mask, wood] = await Promise.all([loadImg(photoSrc), loadImg(maskSrc), loadImg(textureUrl)])
      if (!alive) return
      const W = Math.min(photo.naturalWidth, 1400), s = W / photo.naturalWidth
      const H = Math.round(photo.naturalHeight * s)
      const canvas = canvasRef.current!; canvas.width = W; canvas.height = H
      const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: false })!
      const prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog); gl.useProgram(prog)
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      const mkTex = (img: HTMLImageElement, unit: number, name: string) => {
        const tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.uniform1i(gl.getUniformLocation(prog, name), unit)
      }
      mkTex(photo, 0, "uPhoto"); mkTex(mask, 1, "uMask"); mkTex(wood, 2, "uWood")
      // Luz difusa: foto muy reducida (=borroneada) → sólo lleva sombras/luz amplias, no la trama del piso.
      const blur = document.createElement("canvas"); blur.width = 40; blur.height = Math.max(1, Math.round(40 * H / W))
      const bx = blur.getContext("2d")!; bx.imageSmoothingEnabled = true; bx.drawImage(photo, 0, 0, blur.width, blur.height)
      const blurImg = new Image(); await new Promise<void>((r) => { blurImg.onload = () => r(); blurImg.src = blur.toDataURL() })
      mkTex(blurImg, 3, "uLum")
      // luminancia base del piso (mediana aprox sobre la máscara)
      const mc = document.createElement("canvas"); mc.width = 80; mc.height = 80
      const mx = mc.getContext("2d")!; mx.drawImage(photo, 0, 0, 80, 80); const pd = mx.getImageData(0, 0, 80, 80).data
      mx.drawImage(mask, 0, 0, 80, 80); const md = mx.getImageData(0, 0, 80, 80).data
      const ls: number[] = []
      for (let i = 0; i < pd.length; i += 4) if (md[i] > 128) ls.push((0.299 * pd[i] + 0.587 * pd[i + 1] + 0.114 * pd[i + 2]) / 255)
      ls.sort((a, b) => a - b); const base = ls.length ? ls[Math.floor(ls.length / 2)] : 0.5
      glState.current = { gl, prog, base }
      setQuad(autoQuad(mask)); setReady(true)
    })().catch((e) => console.error("[projector]", e))
    return () => { alive = false }
  }, [photoSrc, maskSrc, textureUrl])

  // render en cada cambio
  useEffect(() => {
    const st = glState.current; if (!st || !quad) return
    const { gl, prog, base } = st
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, "uHinv"), false, new Float32Array(homographyInv(quad)))
    const planks = 6 + (size / 100) * 16                 // 6..22 tablas a lo ancho aprox
    const r = planks / 5                                  // la textura tiene ~5 tablas de ancho
    gl.uniform2f(gl.getUniformLocation(prog, "uRepeat"), r, r)  // isotrópico: mantiene el largo/proporción real de tabla
    gl.uniform1f(gl.getUniformLocation(prog, "uBase"), base)
    gl.uniform1i(gl.getUniformLocation(prog, "uDir"), dir === "vertical" ? 0 : dir === "horizontal" ? 1 : 2)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }, [quad, dir, size, ready])

  useImperativeHandle(ref, () => ({
    getResult: () => { try { return canvasRef.current?.toDataURL("image/jpeg", 0.92) ?? null } catch { return null } } }), [])

  // arrastre de los 4 handles
  function onDown(i: number) { return (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = i } }
  function onMove(e: React.PointerEvent) {
    if (drag.current == null || !quad) return
    const r = wrapRef.current!.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    const nq = quad.slice(); nq[drag.current] = { x, y }; setQuad(nq)
  }
  function onUp() { drag.current = null }

  return (
    <div className="space-y-2">
      <div ref={wrapRef} className="relative inline-block w-full leading-[0] touch-none" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
        <canvas ref={canvasRef} className="w-full rounded-lg border block" />
        {quad?.map((p, i) => (
          <button key={i} onPointerDown={onDown(i)}
            className="absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full bg-white border-2 border-primary shadow touch-none"
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-label={`esquina ${i + 1}`} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Arrastrá las 4 esquinas para que el marco calce con el piso (el fondo del ambiente = las esquinas de arriba).</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Dirección:</span>
        {([["vertical", "Hacia el fondo"], ["horizontal", "A lo ancho"], ["diagonal", "Diagonal"]] as const).map(([v, l]) => (
          <Button key={v} type="button" size="sm" variant={dir === v ? "default" : "outline"} onClick={() => setDir(v)}>{l}</Button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Tamaño de tabla
        <input type="range" min={0} max={100} value={size} onChange={(e) => setSize(Number(e.target.value))} className="flex-1 max-w-[220px]" />
      </label>
    </div>
  )
})

// Auto-propone el quad del piso desde la máscara: extremos del piso en la fila más lejana (arriba)
// y la más cercana (abajo).
function autoQuad(mask: HTMLImageElement): Pt[] {
  const w = 100, h = 100
  const c = document.createElement("canvas"); c.width = w; c.height = h
  const x = c.getContext("2d")!; x.drawImage(mask, 0, 0, w, h)
  const d = x.getImageData(0, 0, w, h).data
  let minX = w, maxX = 0, minY = h, maxY = 0, any = false
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (d[(yy * w + xx) * 4] > 128) {
    any = true; minX = Math.min(minX, xx); maxX = Math.max(maxX, xx); minY = Math.min(minY, yy); maxY = Math.max(maxY, yy)
  }
  if (!any) return [{ x: 0.2, y: 0.55 }, { x: 0.8, y: 0.55 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  // Trapecio del recuadro del piso: fondo (arriba) más angosto, frente (abajo) al ancho completo.
  const nx = minX / w, xx = maxX / w, ny = minY / h, yy = maxY / h
  const inset = (xx - nx) * 0.18
  return [
    { x: nx + inset, y: ny }, { x: xx - inset, y: ny },   // esquinas del fondo
    { x: xx, y: yy }, { x: nx, y: yy },                    // esquinas del frente
  ]
}
