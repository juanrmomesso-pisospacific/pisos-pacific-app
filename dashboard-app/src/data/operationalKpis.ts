import type { Container, Product, Quote, Sale } from "@/lib/types"

export function inTransitMeters(containers: Container[]): { meters: number; nextEta: string | null; nextEtaContainerId: string | null; count: number } {
  let meters = 0
  let nextEta: string | null = null
  let nextEtaContainerId: string | null = null
  let count = 0
  for (const c of containers) {
    if (c.status !== "in_transit") continue
    count += 1
    meters += (c.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0)
    if (!nextEta || c.eta < nextEta) {
      nextEta = c.eta
      nextEtaContainerId = c.id
    }
  }
  return { meters, nextEta, nextEtaContainerId, count }
}

export function reservedStockSummary(products: Product[]): { totalReserved: number; productsReserved: Product[] } {
  const productsReserved = products.filter((p) => (p.reservedStock ?? 0) > 0).sort((a, b) => (b.reservedStock ?? 0) - (a.reservedStock ?? 0))
  const totalReserved = productsReserved.reduce((s, p) => s + (p.reservedStock || 0), 0)
  return { totalReserved, productsReserved }
}

export function stockOutsWithDemand(products: Product[], quotes: Quote[], windowDays: number) {
  // demand = SKUs that appeared in any quote item within the window
  const cutoff = Date.now() - windowDays * 86400000
  const demandSku = new Set<string>()
  for (const q of quotes) {
    const t = +new Date(q.created_at)
    if (!isFinite(t) || t < cutoff) continue
    for (const it of (q.items ?? [])) demandSku.add(it.sku)
  }
  const list = products
    .filter((p) => (Number(p.stock) || 0) <= 0 && (p.reservedStock > 0 || demandSku.has(p.sku)))
    .map((p) => ({ p, demandAtRisk: (p.reservedStock || 0) * (p.price || 0) }))
    .sort((a, b) => b.demandAtRisk - a.demandAtRisk)
  return { count: list.length, list }
}

export function conversionFunnel(quotes: Quote[], windowDays: number) {
  const cutoff = Date.now() - windowDays * 86400000
  const inWindow = quotes.filter((q) => +new Date(q.created_at) >= cutoff)
  const c = { Borrador: 0, Enviado: 0, Aceptado: 0, total: inWindow.length }
  for (const q of inWindow) {
    if (q.status === "Borrador") c.Borrador += 1
    else if (q.status === "Enviado") c.Enviado += 1
    else if (q.status === "Aceptado") c.Aceptado += 1
  }
  const conversion = c.total > 0 ? c.Aceptado / c.total : 0
  return { ...c, conversion, rows: inWindow }
}

export function relatedSalesForReserved(sales: Sale[], productId: string, sku: string): Sale[] {
  return sales.filter((s) => !s.stock_deducted && (s.items ?? []).some((it) => it.product_id === productId || it.sku === sku))
}
