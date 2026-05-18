import { useMemo, useState } from "react"
import { Ship, Lock, AlertTriangle, Target, Plus } from "lucide-react"
import { KpiCard } from "@/components/KpiCard"
import { Button } from "@/components/ui/button"
import { ContainerImportForm } from "@/components/forms/ContainerImportForm"
import { useApi } from "@/lib/api"
import { fmtInt, fmtMoney, fmtPct } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { inTransitMeters, reservedStockSummary, stockOutsWithDemand, conversionFunnel } from "@/data/operationalKpis"
import type { Container, Product, Quote } from "@/lib/types"

type SettingsResp = { dashboardThresholds?: { conversionWindowDays?: number; lowStockUnits?: number } }

function ContainersDrawer({ containers, onReceive }: { containers: Container[]; onReceive: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">{containers.length} containers en tránsito</div>
        <Button size="sm" onClick={() => setImportOpen(true)}><Plus className="h-3.5 w-3.5" />Nuevo container</Button>
      </div>
      {containers.length === 0 ? <div className="text-sm text-muted-foreground italic">Sin containers en tránsito.</div> : containers.map((c) => {
        const total = c.items.reduce((s, i) => s + i.quantity, 0)
        const days = Math.ceil((+new Date(c.eta) - Date.now()) / 86400000)
        return (
          <div key={c.id} className="rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <div className="text-base font-medium">{c.id} · {c.vessel}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{c.supplier} · ETA {c.eta}{days >= 0 ? ` · en ${days}d` : ""}</div>
              </div>
              <Button size="sm" variant="default" disabled={busy === c.id} onClick={async () => { setBusy(c.id); try { await onReceive(c.id) } finally { setBusy(null) } }}>
                {busy === c.id ? "Procesando…" : "Marcar como recibido"}
              </Button>
            </div>
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border"><th className="text-left py-1.5">SKU</th><th className="text-left py-1.5">Descripción</th><th className="text-right py-1.5">m²</th><th className="text-right py-1.5">Costo USD</th></tr>
              </thead>
              <tbody>
                {c.items.map((it) => (
                  <tr key={it.sku + (it.lot ?? "")} className="border-b border-border/40">
                    <td className="py-1.5 text-muted-foreground">{it.sku}</td>
                    <td className="py-1.5">{it.description}</td>
                    <td className="py-1.5 text-right tabular">{fmtInt(it.quantity)}</td>
                    <td className="py-1.5 text-right tabular text-muted-foreground">${it.unit_cost_usd.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="font-medium"><td className="py-1.5"></td><td className="py-1.5">Total</td><td className="py-1.5 text-right tabular">{fmtInt(total)}</td><td></td></tr>
              </tbody>
            </table>
            {c.notes ? <div className="text-xs text-muted-foreground mt-3 italic">{c.notes}</div> : null}
          </div>
        )
      })}
      <ContainerImportForm open={importOpen} onOpenChange={setImportOpen} />
    </div>
  )
}

function ReservedDrawer({ rows }: { rows: Product[] }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Sin stock reservado.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border"><th className="text-left py-2">Producto</th><th className="text-right py-2">Reservado</th><th className="text-right py-2">Disponible</th><th className="text-right py-2">Precio</th></tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="border-b border-border/50">
            <td className="py-2"><div className="text-foreground">{p.name}</div><div className="text-xs text-muted-foreground">{p.sku}</div></td>
            <td className="py-2 text-right tabular">{fmtInt(p.reservedStock)}</td>
            <td className={cn("py-2 text-right tabular", (p.stock || 0) <= 0 ? "text-rose-400" : "text-muted-foreground")}>{fmtInt(p.stock)}</td>
            <td className="py-2 text-right tabular text-muted-foreground">{fmtMoney(p.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StockOutsDrawer({ rows }: { rows: { p: Product; demandAtRisk: number }[] }) {
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">No hay productos en quiebre con demanda activa.</div>
  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
        <tr className="border-b border-border"><th className="text-left py-2">Producto</th><th className="text-right py-2">Reservado</th><th className="text-right py-2">Demanda en riesgo</th></tr>
      </thead>
      <tbody>
        {rows.map(({ p, demandAtRisk }) => (
          <tr key={p.id} className="border-b border-border/50">
            <td className="py-2"><div className="text-foreground">{p.name}</div><div className="text-xs text-muted-foreground">{p.sku}</div></td>
            <td className="py-2 text-right tabular">{fmtInt(p.reservedStock)}</td>
            <td className="py-2 text-right tabular font-medium">{fmtMoney(demandAtRisk)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function FunnelDrawer({ funnel, windowDays }: { funnel: ReturnType<typeof conversionFunnel>; windowDays: number }) {
  const max = Math.max(funnel.Borrador, funnel.Enviado, funnel.Aceptado, 1)
  const Bar = ({ label, n, color }: { label: string; n: number; color: string }) => (
    <div className="mb-3">
      <div className="flex items-baseline justify-between text-sm mb-1"><span>{label}</span><span className="tabular text-muted-foreground">{n} cotizaciones</span></div>
      <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full" style={{ width: `${(n / max) * 100}%`, background: color }} /></div>
    </div>
  )
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Cotizaciones creadas en los últimos {windowDays} días: <b className="text-foreground">{funnel.total}</b></p>
      <Bar label="Borrador" n={funnel.Borrador} color="var(--muted-foreground)" />
      <Bar label="Enviado" n={funnel.Enviado} color="var(--chart-2)" />
      <Bar label="Aceptado" n={funnel.Aceptado} color="var(--primary)" />
      <div className="mt-6 p-3 rounded-lg bg-muted">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Tasa de conversión</div>
        <div className="serif text-2xl font-semibold">{fmtPct(funnel.conversion)}</div>
      </div>
    </div>
  )
}

export function OperationalKpis() {
  const containers = useApi<Container[]>("/api/containers")
  const products = useApi<Product[]>("/api/products")
  const quotes = useApi<Quote[]>("/api/quotes")
  const settings = useApi<SettingsResp>("/api/settings")
  const [reloadKey, setReloadKey] = useState(0)

  const windowDays = settings.data?.dashboardThresholds?.conversionWindowDays ?? 30

  const cs = containers.data ?? []
  const ps = products.data ?? []
  const qs = quotes.data ?? []

  const transit = useMemo(() => inTransitMeters(cs), [cs])
  const reserved = useMemo(() => reservedStockSummary(ps), [ps])
  const stockOuts = useMemo(() => stockOutsWithDemand(ps, qs, windowDays), [ps, qs, windowDays])
  const funnel = useMemo(() => conversionFunnel(qs, windowDays), [qs, windowDays])

  const onReceive = async (id: string) => {
    await fetch(`/api/containers/${id}/receive`, { method: "POST" })
    setReloadKey((k) => k + 1) // bust caches
    // Force a refetch by reloading the page; useApi doesn't expose refetch yet
    window.location.reload()
  }

  // suppress unused warning for reloadKey
  void reloadKey

  if (containers.loading || products.loading || quotes.loading) {
    return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">{[0,1,2,3].map((i) => <div key={i} className="rounded-xl border border-border bg-card h-32 animate-pulse" />)}</div>
  }

  const inTransit = cs.filter((c) => c.status === "in_transit")

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiCard
        label="Container en camino"
        icon={Ship}
        value={fmtInt(transit.meters) + " m²"}
        footer={`${transit.count} containers · próx. ETA ${transit.nextEta ?? "—"}${transit.nextEtaContainerId ? ` (${transit.nextEtaContainerId})` : ""}`}
        drawerTitle="Containers en tránsito"
        drawerDescription="Packing list por container, con acción para acreditar al inventario"
        drawerContent={<ContainersDrawer containers={inTransit} onReceive={onReceive} />}
        tooltip="Metros cuadrados totales en containers con estado in_transit. La acción 'Marcar como recibido' acredita el stock al inventario y registra un movimiento."
      />
      <KpiCard
        label="Stock reservado"
        icon={Lock}
        value={fmtInt(reserved.totalReserved) + " m²"}
        footer={`${reserved.productsReserved.length} productos con reservas activas`}
        drawerTitle="Stock reservado"
        drawerDescription="Cantidades comprometidas en cotizaciones/ventas activas"
        drawerContent={<ReservedDrawer rows={reserved.productsReserved} />}
        tooltip="Suma de product.reservedStock — m² comprometidos por cotizaciones aceptadas o ventas que aún no descontaron stock."
      />
      <KpiCard
        label="Quiebres de stock"
        icon={AlertTriangle}
        value={fmtInt(stockOuts.count)}
        footer={`Productos en 0 con demanda en últimos ${windowDays}d`}
        drawerTitle="Quiebres de stock con demanda"
        drawerDescription="Productos con stock 0 que tienen reservas o cotizaciones recientes"
        drawerContent={<StockOutsDrawer rows={stockOuts.list} />}
        tooltip={`Productos con stock = 0 que (a) tienen reservas activas o (b) aparecieron en cotizaciones en los últimos ${windowDays} días. Configurable en Settings.`}
      />
      <KpiCard
        label="Conversión cotizaciones"
        icon={Target}
        value={fmtPct(funnel.conversion)}
        footer={`${funnel.Aceptado} de ${funnel.total} aceptadas · últ. ${windowDays}d`}
        drawerTitle={`Conversión · últimos ${windowDays} días`}
        drawerDescription="Embudo de cotizaciones por estado"
        drawerContent={<FunnelDrawer funnel={funnel} windowDays={windowDays} />}
        tooltip={`% de cotizaciones creadas en los últimos ${windowDays} días que están en estado Aceptado. Ventana configurable en Settings.`}
      />
    </div>
  )
}
