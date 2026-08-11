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

// render: dataURL del inpaint · mask: dataURL b/n (blanco = piso) · mean/std: stats de la muestra.
export async function applyToneTransfer(
  render: string, mask: string, mean: number[], std: number[]
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

  for (let i = 0; i < d.length; i += 4) {
    const a = md[i] / 255                    // feather = blend suave del recolor
    if (a === 0) continue
    for (let k = 0; k < 3; k++) {
      const nv = (d[i + k] - fm[k]) * ratio[k] + mean[k]
      d[i + k] = Math.max(0, Math.min(255, d[i + k] * (1 - a) + nv * a))
    }
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL("image/jpeg", 0.92)
}
