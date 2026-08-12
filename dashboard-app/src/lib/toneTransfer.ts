// Transferencia de color (Reinhard en RGB): fija el TONO EXACTO del SKU en la zona del piso.
// FLUX hace la veta/perspectiva/iluminación, pero el color no es confiable en fotos reales cálidas.
// Acá remapeamos la media/desvío de la zona pintada a los de la muestra real del banco
// (rgb_mean/rgb_std del catálogo) → el piso queda del color del producto, con la veta intacta.

async function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Combina proyección + render: mantiene el COLOR/VETA EXACTOS de la proyección (el producto real)
// pero le aplica la ILUMINACIÓN del render de IA (sombras/luz/reflejos) → realismo + fidelidad.
// out = proyección re-iluminada por (lumRender / lumProyección) sólo dentro de la máscara.
export async function combineRelight(projection: string, refined: string, mask: string): Promise<string> {
  const [pi, ri, mi] = await Promise.all([loadImg(projection), loadImg(refined), loadImg(mask)])
  const W = pi.naturalWidth, H = pi.naturalHeight
  const c = document.createElement("canvas"); c.width = W; c.height = H
  const ctx = c.getContext("2d")!; ctx.drawImage(pi, 0, 0)
  const out = ctx.getImageData(0, 0, W, H); const o = out.data
  const rc = document.createElement("canvas"); rc.width = W; rc.height = H
  const rx = rc.getContext("2d")!; rx.drawImage(ri, 0, 0, W, H)
  const rd = rx.getImageData(0, 0, W, H).data
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H
  const mx = mc.getContext("2d")!; mx.drawImage(mi, 0, 0, W, H)
  const md = mx.getImageData(0, 0, W, H).data
  const L = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b
  for (let i = 0; i < o.length; i += 4) {
    const a = md[i] / 255
    if (a === 0) continue
    const pl = L(o[i], o[i + 1], o[i + 2]) + 1
    const rl = L(rd[i], rd[i + 1], rd[i + 2])
    const ratio = Math.max(0.5, Math.min(1.8, rl / pl))
    const f = 1 + a * (ratio - 1)
    o[i] = Math.min(255, o[i] * f); o[i + 1] = Math.min(255, o[i + 1] * f); o[i + 2] = Math.min(255, o[i + 2] * f)
  }
  ctx.putImageData(out, 0, 0)
  return c.toDataURL("image/jpeg", 0.92)
}

// Media/desvío por canal de la zona pintada (blanco en la máscara) de una imagen.
export async function floorStats(image: string, mask: string): Promise<{ mean: number[]; std: number[] }> {
  const [ii, mi] = await Promise.all([loadImg(image), loadImg(mask)])
  const W = ii.naturalWidth, H = ii.naturalHeight
  const c = document.createElement("canvas"); c.width = W; c.height = H
  const ctx = c.getContext("2d")!; ctx.drawImage(ii, 0, 0)
  const d = ctx.getImageData(0, 0, W, H).data
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H
  const mx = mc.getContext("2d")!; mx.drawImage(mi, 0, 0, W, H)
  const md = mx.getImageData(0, 0, W, H).data
  let n = 0; const m = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) if (md[i] > 128) { n++; m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2] }
  if (!n) return { mean: [128, 128, 128], std: [40, 40, 40] }
  for (let k = 0; k < 3; k++) m[k] /= n
  const s = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) if (md[i] > 128) for (let k = 0; k < 3; k++) { const dv = d[i + k] - m[k]; s[k] += dv * dv }
  for (let k = 0; k < 3; k++) s[k] = Math.sqrt(s[k] / n)
  return { mean: m, std: s }
}

// render: dataURL del inpaint · mask: dataURL b/n (blanco = piso) · mean/std: stats de la muestra.
// sat: realce de croma (1.0 = sin realce, para fijar el color EXACTO de la proyección).
export async function applyToneTransfer(
  render: string, mask: string, mean: number[], std: number[], sat = 1.18
): Promise<string> {
  const [ri, mi] = await Promise.all([loadImg(render), loadImg(mask)])
  const W = ri.naturalWidth, H = ri.naturalHeight
  const c = document.createElement("canvas"); c.width = W; c.height = H
  const ctx = c.getContext("2d")!; ctx.drawImage(ri, 0, 0)
  const img = ctx.getImageData(0, 0, W, H); const d = img.data
  // máscara escalada al tamaño del render
  const mc = document.createElement("canvas"); mc.width = W; mc.height = H
  const mctx = mc.getContext("2d")!; mctx.drawImage(mi, 0, 0, W, H)
  const md = mctx.getImageData(0, 0, W, H).data

  // media/desvío de la zona del piso en el render
  let n = 0; const fm = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) if (md[i] > 128) { n++; fm[0] += d[i]; fm[1] += d[i + 1]; fm[2] += d[i + 2] }
  if (!n) return render
  fm[0] /= n; fm[1] /= n; fm[2] /= n
  const fs = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) if (md[i] > 128) for (let k = 0; k < 3; k++) { const dv = d[i + k] - fm[k]; fs[k] += dv * dv }
  for (let k = 0; k < 3; k++) fs[k] = Math.sqrt(fs[k] / n) + 1e-3
  // ratio de desvío acotado (evita amplificar ruido o aplanar de más)
  const ratio = [0, 1, 2].map((k) => Math.min(2.5, Math.max(0.4, std[k] / fs[k])))

  const SAT = sat   // realce de saturación: evita que quede gris plano (madera cálida, no apagada)
  for (let i = 0; i < d.length; i += 4) {
    const a = md[i] / 255                    // feather = blend suave del recolor
    if (a === 0) continue
    // color remapeado a la muestra del SKU
    const nv = [0, 1, 2].map((k) => (d[i + k] - fm[k]) * ratio[k] + mean[k])
    // realce de croma alrededor del gris del propio pixel (mantiene el tono, sube la riqueza)
    const g = (nv[0] + nv[1] + nv[2]) / 3
    for (let k = 0; k < 3; k++) {
      const sv = g + (nv[k] - g) * SAT
      d[i + k] = Math.max(0, Math.min(255, d[i + k] * (1 - a) + sv * a))
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL("image/jpeg", 0.92)
}
