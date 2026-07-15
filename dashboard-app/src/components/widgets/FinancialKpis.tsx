import { useMemo } from "react"
import { TrendingUp, Wallet, Truck, Percent } from "lucide-react"
import { KpiCard } from "@/components/KpiCard"
import { Sparkline } from "@/components/Sparkline"
import { useApi } from "@/lib/api"
import { usePeriod } from "@/contexts/PeriodContext"
import { useRole } from "@/contexts/RoleContext"
import { fmtMoney, fmtPct, appLocale } from "@/lib/utils"
import { fmtRange } from "@/lib/period"
import { sparklineRevenue, withPriorComparison } from "@/data/financialKpis"
import type { Product, Sale } from "@/lib/types"

function ConfirmedTable({ rows }: { rows: Sale[] }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Sin ventas en el período.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border"><th className="text-left py-2">#</th><th className="text-left py-2">Cliente</th><th className="text-left py-2">Fecha</th><th className="text-right py-2">Total</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border/50">
            <td className="py-2 text-muted-foreground">#{r.quote_number}</td>
            <td className="py-2">{r.client_name}</td>
            <td className="py-2 text-muted-foreground">{new Date(r.created_at).toLocaleDateString(appLocale())}</td>
            <td className="py-2 text-right tabular">{fmtMoney(r.contract_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CobroTable({ rows }: { rows: Sale[] }) {
  const now = Date.now()
  const sorted = [...rows].sort((a, b) => (b.financial_position?.balance_due ?? 0) - (a.financial_position?.balance_due ?? 0))
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border"><th className="text-left py-2">Cliente</th><th className="text-left py-2">Días</th><th className="text-right py-2">Saldo</th></tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const days = Math.floor((now - +new Date(r.created_at)) / 86400000)
          return (
            <tr key={r.id} className="border-b border-border/50">
              <td className="py-2"><div>{r.client_name}</div><div className="text-xs text-muted-foreground">#{r.quote_number}</div></td>
              <td className="py-2"><span className={days > 30 ? "text-rose-400" : "text-muted-foreground"}>{days}d</span></td>
              <td className="py-2 text-right tabular">{fmtMoney(r.financial_position?.balance_due ?? 0)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function EntregaTable({ rows }: { rows: Sale[] }) {
  const sorted = [...rows].sort((a, b) => (a.delivery_date ?? "9999").localeCompare(b.delivery_date ?? "9999"))
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border"><th className="text-left py-2">Cliente</th><th className="text-left py-2">Estado</th><th className="text-left py-2">Entrega</th><th className="text-right py-2">Total</th></tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={r.id} className="border-b border-border/50">
            <td className="py-2"><div>{r.client_name}</div><div className="text-xs text-muted-foreground">#{r.quote_number}</div></td>
            <td className="py-2 text-xs">{r.status}</td>
            <td className="py-2 text-xs text-muted-foreground">{r.delivery_date ?? "—"}</td>
            <td className="py-2 text-right tabular">{fmtMoney(r.contract_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function FinancialKpis() {
  const { range } = usePeriod()
  const { role } = useRole()
  const sales = useApi<Sale[]>("/api/sales")
  const products = useApi<Product[]>("/api/products")

  const productCostBySku = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of products.data ?? []) {
      m.set(p.sku, p.cost ?? 0)
      m.set(p.id, p.cost ?? 0)
    }
    return m
  }, [products.data])

  const filteredSales = useMemo(() => {
    const all = sales.data ?? []
    if (role.kind !== "vendor") return all
    // Sales don't all carry seller_name; we approximate via quote lookup later. For now, naive filter:
    return all.filter((s) => (s as any).seller_name === role.sellerName)
  }, [sales.data, role])

  const summary = useMemo(() => withPriorComparison(filteredSales, range, productCostBySku), [filteredSales, range, productCostBySku])
  const spark = useMemo(() => sparklineRevenue(filteredSales, range.to, 6), [filteredSales, range])

  const confirmedInPeriod = useMemo(() => filteredSales.filter((s) => s.status === "Confirmado" && new Date(s.created_at) >= range.from && new Date(s.created_at) <= range.to), [filteredSales, range])
  const cobroRows = useMemo(() => filteredSales.filter((s) => (s.financial_position?.balance_due ?? 0) > 0), [filteredSales])
  const entregaRows = useMemo(() => filteredSales.filter((s) => !s.stock_deducted && ["Confirmado","Programado","En proceso"].includes(s.status)), [filteredSales])

  if (sales.loading || products.loading) {
    return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">{[0,1,2,3].map((i) => <div key={i} className="rounded-xl border border-border bg-card h-32 animate-pulse" />)}</div>
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Ventas (período)"
        icon={TrendingUp}
        value={fmtMoney(summary.curr.revenue)}
        delta={summary.deltaRevenue}
        deltaSublabel="vs anterior"
        footer={`${summary.curr.count} ventas Confirmadas · Ticket prom. ${fmtMoney(summary.curr.avgTicket)}`}
        sparkline={<Sparkline values={spark} />}
        drawerTitle="Ventas Confirmadas"
        drawerDescription={`Período: ${fmtRange(range)} · ${summary.curr.count} ventas`}
        drawerContent={<ConfirmedTable rows={confirmedInPeriod} />}
        tooltip="Suma de contract_total de ventas con estado Confirmado en el período. Excluye Programado, En proceso y Finalizado."
      />
      <KpiCard
        label="Pendientes de Cobro"
        icon={Wallet}
        value={fmtMoney(summary.curr.cobroTotal)}
        footer={`${summary.curr.cobroCount} ventas pendientes${summary.curr.oldestCobroDays != null ? ` · más vieja: ${summary.curr.oldestCobroDays}d` : ""}`}
        drawerTitle="Pendientes de Cobro"
        drawerDescription="Saldos abiertos por venta, ordenados por monto"
        drawerContent={<CobroTable rows={cobroRows} />}
        tooltip="Saldos abiertos acumulados (no se filtra por período). Es la suma de financial_position.balance_due de todas las ventas con saldo > 0."
      />
      <KpiCard
        label="Pendientes de Entrega"
        icon={Truck}
        value={fmtMoney(summary.curr.entregaTotal)}
        footer={`${summary.curr.entregaCount} ventas a despachar${summary.curr.nextDeliveryISO ? ` · próx: ${summary.curr.nextDeliveryISO}` : ""}`}
        drawerTitle="Pendientes de Entrega"
        drawerDescription="Ventas confirmadas o programadas sin despachar"
        drawerContent={<EntregaTable rows={entregaRows} />}
        tooltip="Valor total de ventas que aún no se entregaron (stock_deducted = false), en estados Confirmado, Programado o En proceso."
      />
      <KpiCard
        label="Margen Neto"
        icon={Percent}
        value={fmtMoney(summary.curr.margin)}
        delta={summary.deltaMargin}
        deltaSublabel="vs anterior"
        footer={`${fmtPct(summary.curr.marginPct)} sobre ventas · COGS ${fmtMoney(summary.curr.cogs)}`}
        tooltip="Margen Neto = Ingresos − COGS. COGS se calcula como Σ (cantidad × costo unitario del producto) para todas las líneas de ventas Confirmadas en el período."
      />
    </div>
  )
}
