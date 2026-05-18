import type { Sale } from "@/lib/types"
import { inRange, priorRange, type Range, lastNMonths } from "@/lib/period"

export type FinancialAggregate = {
  revenue: number
  count: number
  avgTicket: number
  cogs: number
  margin: number
  marginPct: number
  // Pendientes de cobro (accumulated, NOT period-bound)
  cobroTotal: number
  cobroCount: number
  oldestCobroDays: number | null
  // Pendientes de entrega (sales confirmed, no stock_deducted, not finalized)
  entregaTotal: number
  entregaCount: number
  nextDeliveryISO: string | null
}

const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d }

function lineCogs(item: Sale["items"][number], productCostBySku: Map<string, number>): number {
  const cost = productCostBySku.get(item.sku) ?? productCostBySku.get(item.product_id) ?? 0
  return (Number(item.quantity) || 0) * cost
}

export function aggregate(sales: Sale[], range: Range, productCostBySku: Map<string, number>): FinancialAggregate {
  let revenue = 0, count = 0, cogs = 0
  for (const s of sales) {
    if (s.status !== "Confirmado") continue
    if (!inRange(s.created_at, range)) continue
    revenue += s.contract_total || 0
    count += 1
    for (const it of (s.items || [])) cogs += lineCogs(it, productCostBySku)
  }
  const margin = revenue - cogs
  const marginPct = revenue > 0 ? margin / revenue : 0
  const avgTicket = count > 0 ? revenue / count : 0

  // Pendientes de cobro — accumulated, all-time (matches existing dashboard label)
  let cobroTotal = 0, cobroCount = 0, oldestDays: number | null = null
  const now = today()
  for (const s of sales) {
    const due = s.financial_position?.balance_due ?? 0
    if (due > 0) {
      cobroTotal += due
      cobroCount += 1
      const d = new Date(s.created_at)
      if (!isNaN(+d)) {
        const ageDays = Math.floor((+now - +d) / 86400000)
        if (oldestDays == null || ageDays > oldestDays) oldestDays = ageDays
      }
    }
  }

  // Pendientes de entrega — confirmed/programmed/in-process but not stock_deducted
  let entregaTotal = 0, entregaCount = 0, nextDelivery: string | null = null
  for (const s of sales) {
    if (s.status === "Finalizado") continue
    if (s.stock_deducted) continue
    if (!["Confirmado","Programado","En proceso"].includes(s.status)) continue
    entregaTotal += s.contract_total || 0
    entregaCount += 1
    const dd = s.delivery_date
    if (dd && (!nextDelivery || dd < nextDelivery)) nextDelivery = dd
  }

  return {
    revenue, count, avgTicket, cogs, margin, marginPct,
    cobroTotal, cobroCount, oldestCobroDays: oldestDays,
    entregaTotal, entregaCount, nextDeliveryISO: nextDelivery,
  }
}

export function computeDelta(current: number, prior: number): { pct: number; isUp: boolean } | null {
  if (prior === 0 || !isFinite(prior)) return null
  const pct = (current - prior) / prior
  return { pct, isUp: pct > 0 }
}

export function sparklineRevenue(sales: Sale[], end: Date, n = 6): number[] {
  const months = lastNMonths(end, n)
  return months.map((m) =>
    sales.reduce((sum, s) => {
      if (s.status !== "Confirmado") return sum
      const d = new Date(s.created_at)
      if (d >= m.from && d <= m.to) return sum + (s.contract_total || 0)
      return sum
    }, 0)
  )
}

export function withPriorComparison(sales: Sale[], range: Range, productCostBySku: Map<string, number>) {
  const curr = aggregate(sales, range, productCostBySku)
  const prev = aggregate(sales, priorRange(range), productCostBySku)
  return {
    curr,
    prev,
    deltaRevenue: computeDelta(curr.revenue, prev.revenue),
    deltaMargin: computeDelta(curr.margin, prev.margin),
    deltaCount: computeDelta(curr.count, prev.count),
  }
}
