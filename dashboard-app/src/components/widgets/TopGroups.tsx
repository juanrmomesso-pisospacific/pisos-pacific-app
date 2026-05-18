import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { inRange } from "@/lib/period"
import { fmtMoney, fmtPct } from "@/lib/utils"
import { GROUP_ORDER, GROUP_COLOR, groupForCategory, type GroupId } from "@/lib/groups"
import type { Product, Sale } from "@/lib/types"

export function TopGroups() {
  const { range } = usePeriod()
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []

  const summary = useMemo(() => {
    const prodCat = new Map<string, string>()
    for (const p of products) { prodCat.set(p.id, p.category); prodCat.set(p.sku, p.category) }
    const byGroup: Record<GroupId, number> = { "Pisos H2O": 0, "Pisos de Madera": 0, "Otros": 0 }
    let total = 0
    for (const s of sales) {
      if (s.status !== "Confirmado") continue
      if (!inRange(s.created_at, range)) continue
      const lineSum = s.items.reduce((a, i) => a + (Number(i.total) || 0), 0) || 1
      for (const it of s.items) {
        const cat = prodCat.get(it.product_id) ?? prodCat.get(it.sku) ?? it.category ?? ""
        const grp = groupForCategory(cat === "Madera" ? "Pisos de Madera" : cat === "H2O" ? "Pisos H2O" : cat)
        const share = (Number(it.total) || 0) / lineSum
        const rev = share * (s.contract_total || lineSum)
        byGroup[grp] += rev
        total += rev
      }
    }
    return { byGroup, total }
  }, [sales, products, range])

  const max = Math.max(1, ...GROUP_ORDER.map((g) => summary.byGroup[g]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grupos · ingresos</CardTitle>
        <CardDescription>Ventas Confirmadas en el período</CardDescription>
      </CardHeader>
      <CardContent>
        {summary.total === 0 ? (
          <div className="text-sm text-muted-foreground py-6">Sin ventas en el período seleccionado.</div>
        ) : (
          <div className="space-y-3">
            {GROUP_ORDER.map((g) => {
              const v = summary.byGroup[g]
              const pct = summary.total > 0 ? v / summary.total : 0
              return (
                <div key={g}>
                  <div className="flex items-baseline justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} />
                      {g}
                    </span>
                    <span className="tabular">{fmtMoney(v)} <span className="text-muted-foreground text-xs">· {fmtPct(pct)}</span></span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${(v / max) * 100}%`, background: GROUP_COLOR[g] }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
