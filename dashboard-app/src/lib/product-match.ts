// Matching de productos para la importación de contenedores (packing list / invoice).
// Misma lógica que integrations/product-match.mjs (backend). Resuelve un ítem a un producto
// existente y aprende la asociación (alias por descripción) para futuras importaciones.
import type { Product } from "@/lib/types"

export type ProductAlias = { id?: string; alias: string; raw?: string; product_id: string }

export const normProd = (s: unknown): string =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()

export function aliasIndex(aliases: ProductAlias[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const a of aliases || []) if (a && a.alias) m.set(String(a.alias), a.product_id)
  return m
}

// Cascada: (1) alias aprendido por descripción, (2) SKU exacto normalizado, (3) nombre ≈ descripción.
export function findProductMatch(
  products: Product[],
  aliases: Map<string, string> | ProductAlias[],
  item: { sku?: string; description?: string },
): Product | null {
  const ndesc = normProd(item.description)
  const idx = aliases instanceof Map ? aliases : aliasIndex(aliases)
  if (ndesc && idx.has(ndesc)) {
    const pid = idx.get(ndesc)
    const p = products.find((x) => x.id === pid)
    if (p) return p
  }
  const nsku = normProd(item.sku)
  if (nsku) {
    const p = products.find((x) => normProd(x.sku) === nsku)
    if (p) return p
  }
  if (ndesc) {
    const p = products.find((x) => normProd(x.name) === ndesc || normProd((x as any).shortName) === ndesc)
    if (p) return p
  }
  return null
}

// Productos más parecidos a la descripción (para precargar el buscador "Asociar producto").
export function suggestProducts(products: Product[], description: string, k = 6): Product[] {
  const n = normProd(description)
  if (!n) return []
  const toks = new Set(n.split(" ").filter(Boolean))
  const scored: { p: Product; score: number }[] = []
  for (const p of products) {
    const pn = normProd(p.name) || normProd((p as any).shortName)
    if (!pn) continue
    const pt = new Set(pn.split(" ").filter(Boolean))
    let score: number
    if (pn === n) score = 1
    else if (pn.includes(n) || n.includes(pn)) score = 0.85
    else {
      const inter = [...toks].filter((t) => pt.has(t)).length
      const uni = new Set([...toks, ...pt]).size
      score = uni ? inter / uni : 0
    }
    if (score >= 0.2) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((x) => x.p)
}
