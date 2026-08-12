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
uniform sampler2D uPhoto, uMask, uWood, uLum, uMaskB;
uniform mat3 uHinv;              // imagen -> plano textura (0..1)
uniform float uPlanks;          // tablas a lo ancho del piso
uniform float uBevelDepth;      // profundidad del bisel (H2O ~0.5, Madera ~1.5)
uniform float uBase;            // luminancia base del piso (para re-iluminar)
uniform float uTopY;            // y del fondo del piso (0..1) — para el reflejo del ambiente
uniform float uGloss;           // brillo/reflejo del piso (0..1)
uniform float uLight;           // fuerza del mapa de luz (0=plano, ~0.9=máximo)
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
  // COLOCACIÓN TABLA POR TABLA: cada tabla del render = UNA tabla entera de la textura (sin cruzar
  // juntas) y LARGA (pocas juntas de punta), como un piso colocado de verdad.
  float NTEX = 6.0;                                 // tablas a lo ancho que tiene la foto de textura
  float pw = 1.0 / NTEX;
  float lenRep = max(uPlanks / 17.0, 0.38);         // tablas LARGAS → pocas juntas de punta
  float tx = t.x * uPlanks;
  float idx = floor(tx);                            // índice de tabla (columna)
  float fx = fract(tx);                             // 0..1 a lo ancho de la tabla
  float stagger = hash(idx * 1.7);                  // desfase ALEATORIO por columna
  float ty = t.y * lenRep + stagger;
  float row = floor(ty);                            // tramo de tabla (cambia sólo en las juntas de punta)
  float fy = fract(ty);                             // 0..1 a lo largo del tablón
  float rnd = hash(idx * 3.0 + row * 17.0);         // semilla por tabla
  float off = floor(rnd * NTEX) / NTEX;             // elige UNA tabla de la textura (no cruza juntas)
  // Espejar al azar (horizontal y/o vertical) → variedad sin repetir.
  float sx = fract(rnd * 7.0) > 0.5 ? off + (1.0 - fx) * pw : off + fx * pw;
  float sy = fract(rnd * 13.0) > 0.5 ? 1.0 - fy : fy;
  vec3 wood = texture2D(uWood, vec2(sx, sy)).rgb;
  // BISEL CON RELIEVE: normal en V en los cantos de tabla + luz direccional → los biseles se ven
  // 3D (la luz pega en un lado y sombrea el otro), no una simple línea impresa.
  float bw = 0.05;
  float ex = fx < bw ? (bw - fx) / bw : (fx > 1.0 - bw ? -(fx - (1.0 - bw)) / bw : 0.0);
  float ey = fy < bw ? (bw - fy) / bw : (fy > 1.0 - bw ? -(fy - (1.0 - bw)) / bw : 0.0);
  vec3 N = normalize(vec3(-ex * uBevelDepth, -ey * uBevelDepth * 0.5, 1.0));
  vec3 L = normalize(vec3(0.25, -0.55, 0.8));
  wood *= 0.8 + 0.34 * clamp(dot(N, L), 0.0, 1.0);
  // realce de saturación (compensa el lavado del mipmap → colores más ricos, menos grisáceo)
  float wg = dot(wood, vec3(0.3333));
  wood = clamp(wg + (wood - wg) * 1.14, 0.0, 1.0);
  // sombra de contacto (AO) en los bordes del piso (junto a paredes/muebles) → "apoyado", no pegado
  float mb = texture2D(uMaskB, uv).r;
  wood *= mix(0.72, 1.0, smoothstep(0.35, 0.95, mb));
  // MAPA DE LUZ (técnica del líder Roomvo/Leap Tools): luminancia de la foto MUY borroneada (uLum,
  // sin la trama del piso viejo) NORMALIZADA al promedio del piso → integra las sombras/luz reales de
  // la habitación (gradiente de ventanas, sombras) SIN oscurecer ni aclarar el color del producto.
  // La normalización es la clave: si el piso viejo era oscuro uniforme, el mapa ≈ 1 (no ensombrece).
  float lum = dot(texture2D(uLum, uv).rgb, vec3(0.299,0.587,0.114));
  // Rango angosto + aplicación PARCIAL (uLight, ajustable): integra la luz SIN quemar el sol ni
  // manchar las sombras. uLight=0 → piso plano (sin re-iluminar); subirlo integra más la luz real.
  float lightMap = mix(1.0, clamp(lum / max(uBase, 0.02), 0.62, 1.38), uLight);
  vec3 lit = clamp(wood * lightMap, 0.0, 1.0);
  // REFLEJO del ambiente (ventanas/techo) sobre el piso: espejo del escenario sobre el borde del
  // fondo, con fresnel (más reflejo hacia el fondo) y el brillo del material → look de piso real.
  vec2 reflUV = vec2(uv.x, clamp(2.0 * uTopY - uv.y, 0.0, uTopY));
  vec3 env = texture2D(uLum, reflUV).rgb;
  float fres = mix(0.08, 0.5, clamp(1.0 - q.y, 0.0, 1.0)) * uGloss;
  lit = mix(lit, max(lit, env), fres);
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
  photoSrc: string; maskSrc: string; textureUrl: string; plankMm?: number; serie?: string; depthSrc?: string | null
}>(function FloorProjector({ photoSrc, maskSrc, textureUrl, serie, depthSrc }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const glState = useRef<{ gl: WebGLRenderingContext; prog: WebGLProgram; base: number } | null>(null)
  const maskImgRef = useRef<HTMLImageElement | null>(null)   // máscara cargada (para el cálculo de horizonte)
  const [quad, setQuad] = useState<Pt[] | null>(null)
  const [dir, setDir] = useState<Dir>("vertical")
  const [size, setSize] = useState(50)          // 0..100 → tamaño de tabla (más = tablas más chicas)
  const [gloss, setGloss] = useState(serie === "Madera" ? 30 : 55)   // brillo/reflejo (H2O más satinado)
  const [light, setLight] = useState(60)        // 0..100 → fuerza del mapa de luz (uLight = light/100*0.9)
  // Horizonte (fila 0..1) y centro de fuga x: parametrizan la perspectiva. Cuando existen, el quad se
  // construye con la convergencia CORRECTA (esquinas lejanas apuntando al punto de fuga del piso).
  const [persp, setPersp] = useState<{ yH: number; cx: number } | null>(null)
  const [ready, setReady] = useState(false)
  const drag = useRef<number | null>(null)

  // setup WebGL + texturas + auto-quad
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [photo, mask, wood] = await Promise.all([loadImg(photoSrc), loadImg(maskSrc), loadImg(textureUrl)])
      if (!alive) return
      maskImgRef.current = mask
      const W = Math.min(photo.naturalWidth, 1600), s = W / photo.naturalWidth
      const H = Math.round(photo.naturalHeight * s)
      const canvas = canvasRef.current!; canvas.width = W; canvas.height = H
      const opts = { preserveDrawingBuffer: true, premultipliedAlpha: false }
      const gl = (canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts)) as WebGLRenderingContext
      const isGL2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext
      const aniso = gl.getExtension("EXT_texture_filter_anisotropic") as { TEXTURE_MAX_ANISOTROPY_EXT: number; MAX_TEXTURE_MAX_ANISOTROPY_EXT: number } | null
      const prog = gl.createProgram()!
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog); gl.useProgram(prog)
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      const mkTex = (img: HTMLImageElement, unit: number, name: string, isWood = false) => {
        const tx = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tx)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        // Antialiasing de la madera: mipmaps (WebGL2 acepta no-POT) + anisotrópico → sin pixelado en perspectiva.
        if (isWood && isGL2) {
          gl.generateMipmap(gl.TEXTURE_2D)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
          if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.uniform1i(gl.getUniformLocation(prog, name), unit)
      }
      mkTex(photo, 0, "uPhoto"); mkTex(mask, 1, "uMask"); mkTex(wood, 2, "uWood", true)
      // Luz difusa: foto muy reducida (=borroneada) → sólo lleva sombras/luz amplias, no la trama del piso.
      const blur = document.createElement("canvas"); blur.width = 40; blur.height = Math.max(1, Math.round(40 * H / W))
      const bx = blur.getContext("2d")!; bx.imageSmoothingEnabled = true; bx.drawImage(photo, 0, 0, blur.width, blur.height)
      const blurImg = new Image(); await new Promise<void>((r) => { blurImg.onload = () => r(); blurImg.src = blur.toDataURL() })
      mkTex(blurImg, 3, "uLum")
      // Máscara borroneada → sombra de contacto (AO) en los bordes del piso.
      const mb = document.createElement("canvas"); mb.width = 48; mb.height = Math.max(1, Math.round(48 * H / W))
      const mbx = mb.getContext("2d")!; mbx.imageSmoothingEnabled = true; mbx.drawImage(mask, 0, 0, mb.width, mb.height)
      const maskBImg = new Image(); await new Promise<void>((r) => { maskBImg.onload = () => r(); maskBImg.src = mb.toDataURL() })
      mkTex(maskBImg, 4, "uMaskB")
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
    const planks = 4 + (size / 100) * 12                 // 4..16 tablas a lo ancho (tablas más anchas por defecto)
    gl.uniform1f(gl.getUniformLocation(prog, "uPlanks"), planks)
    gl.uniform1f(gl.getUniformLocation(prog, "uBevelDepth"), serie === "Madera" ? 1.5 : 0.5)
    gl.uniform1f(gl.getUniformLocation(prog, "uBase"), base)
    gl.uniform1f(gl.getUniformLocation(prog, "uTopY"), (quad[0].y + quad[1].y) / 2)  // fondo del piso
    gl.uniform1f(gl.getUniformLocation(prog, "uGloss"), gloss / 100)
    gl.uniform1f(gl.getUniformLocation(prog, "uLight"), (light / 100) * 0.9)
    gl.uniform1i(gl.getUniformLocation(prog, "uDir"), dir === "vertical" ? 0 : dir === "horizontal" ? 1 : 2)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }, [quad, dir, size, ready, serie, gloss, light])

  // Perspectiva automática: cuando llega el mapa de profundidad, deducir el horizonte del piso y
  // sembrar el quad con la convergencia correcta (esquinas lejanas apuntando al punto de fuga).
  useEffect(() => {
    if (!depthSrc || !maskImgRef.current) return
    let alive = true
    ;(async () => {
      const depth = await loadImg(depthSrc)
      if (!alive || !maskImgRef.current) return
      const p = horizonFromDepthMask(depth, maskImgRef.current)
      if (!p) return
      setPersp({ yH: p.yH, cx: p.cx })
      setQuad(perspectiveQuad(p.nearL, p.nearR, p.yF, p.yH, p.cx))
    })().catch((e) => console.error("[projector depth]", e))
    return () => { alive = false }
  }, [depthSrc])

  // Slider "Perspectiva": mueve el horizonte manteniendo las esquinas cercanas → recalcula la
  // convergencia de las esquinas lejanas (sin depender de la profundidad). 0..100 → yH 0.35..0.62.
  function setHorizon(v: number) {
    if (!quad) return
    const yH = 0.35 + (v / 100) * 0.27
    const cx = persp?.cx ?? (quad[3].x + quad[2].x) / 2
    setPersp({ yH, cx })
    const yF = Math.min(quad[0].y, quad[1].y)                       // borde lejano actual
    setQuad(perspectiveQuad(quad[3], quad[2], Math.max(yF, yH + 0.03), yH, cx))
  }
  const perspSlider = persp ? Math.round(((persp.yH - 0.35) / 0.27) * 100) : 50

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
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Brillo del piso
        <input type="range" min={0} max={100} value={gloss} onChange={(e) => setGloss(Number(e.target.value))} className="flex-1 max-w-[220px]" />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Perspectiva
        <input type="range" min={0} max={100} value={perspSlider} onChange={(e) => setHorizon(Number(e.target.value))} className="flex-1 max-w-[220px]" />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Integrar luz
        <input type="range" min={0} max={100} value={light} onChange={(e) => setLight(Number(e.target.value))} className="flex-1 max-w-[220px]" />
      </label>
    </div>
  )
})

// Construye un quad de perspectiva CORRECTA: las esquinas cercanas (nearL/nearR, abajo) se mantienen
// y las lejanas se calculan haciendo converger cada borde lateral hacia el punto de fuga V=(cx,yH)
// sobre la línea de horizonte. Así las tablas convergen bien aunque el piso cubra toda la imagen.
function perspectiveQuad(nearL: Pt, nearR: Pt, yF: number, yH: number, cx: number): Pt[] {
  const yN = (nearL.y + nearR.y) / 2
  const r = (yF - yH) / (yN - yH || 1e-3)          // razón de convergencia (0 en el horizonte, 1 en el frente)
  const fL = { x: cx + (nearL.x - cx) * r, y: yF }
  const fR = { x: cx + (nearR.x - cx) * r, y: yF }
  return [fL, fR, { ...nearR }, { ...nearL }]
}

// Deduce el horizonte del piso a partir del mapa de profundidad (disparidad) y la máscara del piso.
// En un plano, la disparidad (claro=cerca) es LINEAL con la fila de la imagen → ajustando disp = a·y+b
// sobre las filas del piso y extrapolando a disp=0 se obtiene la fila del horizonte (yH), sin FOV.
// Devuelve todo normalizado (0..1). null si no hay suficiente piso o el ajuste no es válido.
function horizonFromDepthMask(depth: HTMLImageElement, mask: HTMLImageElement): { yH: number; cx: number; yF: number; nearL: Pt; nearR: Pt } | null {
  const gw = 160, gh = Math.max(1, Math.round(160 * depth.naturalHeight / depth.naturalWidth))
  const dc = document.createElement("canvas"); dc.width = gw; dc.height = gh
  const dx = dc.getContext("2d")!; dx.drawImage(depth, 0, 0, gw, gh)
  const dd = dx.getImageData(0, 0, gw, gh).data
  const mc = document.createElement("canvas"); mc.width = gw; mc.height = gh
  const mx = mc.getContext("2d")!; mx.drawImage(mask, 0, 0, gw, gh)
  const md = mx.getImageData(0, 0, gw, gh).data
  // Por fila del piso: mediana de disparidad + extremos x. Centro de fuga = centroide x del piso.
  const rows: { y: number; disp: number; minX: number; maxX: number }[] = []
  let sumX = 0, cnt = 0, yTop = gh, yBot = 0
  for (let yy = 0; yy < gh; yy++) {
    const vals: number[] = []; let mnX = gw, mxX = 0
    for (let xx = 0; xx < gw; xx++) {
      const i = (yy * gw + xx) * 4
      if (md[i] > 128) {
        vals.push(dd[i]); mnX = Math.min(mnX, xx); mxX = Math.max(mxX, xx)
        sumX += xx; cnt++; yTop = Math.min(yTop, yy); yBot = Math.max(yBot, yy)
      }
    }
    if (vals.length >= Math.max(3, gw * 0.04)) {
      vals.sort((a, b) => a - b)
      rows.push({ y: (yy + 0.5) / gh, disp: vals[Math.floor(vals.length / 2)], minX: mnX / gw, maxX: mxX / gw })
    }
  }
  if (rows.length < 6 || cnt < 50) return null
  // Ajuste robusto: descartar el 15% de filas más lejanas (arriba, más ruidosas / posible fuga de pared).
  const fit = rows.slice(Math.floor(rows.length * 0.15))
  const n = fit.length
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const r of fit) { sx += r.y; sy += r.disp; sxx += r.y * r.y; sxy += r.y * r.disp }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-9) return null
  const a = (n * sxy - sx * sy) / denom          // pendiente disp/y
  const b = (sy - a * sx) / n
  if (a <= 0.5) return null                        // la disparidad debe crecer hacia abajo (plano de piso)
  let yH = -b / a
  const yFfloor = yTop / gh, yN = (yBot + 0.5) / gh
  yH = Math.max(0.15, Math.min(yFfloor - 0.02, yH))   // el horizonte va por encima del piso visible
  const cx = cnt ? sumX / cnt / gw : 0.5
  // Esquinas cercanas = ancho MÁXIMO del piso en la banda inferior (no sólo la última fila, que puede
  // venir angostada por una pared que entra) → el marco contiene todo el piso cercano. Borde lejano
  // = tope del piso visible. Las esquinas siguen siendo ajustables a mano.
  const band = rows.slice(-Math.max(1, Math.round(rows.length * 0.18)))
  const nearMinX = Math.min(...band.map((r) => r.minX))
  const nearMaxX = Math.max(...band.map((r) => r.maxX))
  const yF = Math.max(yFfloor, yH + 0.03)
  return { yH, cx, yF, nearL: { x: nearMinX, y: yN }, nearR: { x: nearMaxX, y: yN } }
}

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
  const inset = (xx - nx) * 0.26
  return [
    { x: nx + inset, y: ny }, { x: xx - inset, y: ny },   // esquinas del fondo
    { x: xx, y: yy }, { x: nx, y: yy },                    // esquinas del frente
  ]
}
