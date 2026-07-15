import { useMemo } from "react"
import { Ship, FileText, TrendingUp, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useApi } from "@/lib/api"
import { fmtMoney, appLocale } from "@/lib/utils"
import type { Container, Quote, Sale } from "@/lib/types"

type Event = { ts: string; type: "sale" | "quote" | "container" | "container_received"; title: string; subtitle: string; amount?: number; icon: React.ComponentType<{ className?: string }>; color: string }

const NOW = Date.now()
function fmtAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!isFinite(t)) return ""
  const s = Math.max(0, Math.floor((NOW - t) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60); if (m < 60) return `${m}min`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(appLocale(), { day: "numeric", month: "short" })
}

export function ActivityFeed({ max = 20 }: { max?: number }) {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const containers = useApi<Container[]>("/api/containers").data ?? []

  const events: Event[] = useMemo(() => {
    const out: Event[] = []
    for (const s of sales) {
      out.push({ ts: s.created_at, type: "sale", title: s.client_name, subtitle: `Venta #${s.quote_number} · ${s.status}`, amount: s.contract_total, icon: TrendingUp, color: "text-primary" })
    }
    for (const q of quotes) {
      out.push({ ts: q.created_at, type: "quote", title: q.client_name, subtitle: `Cotización #${q.quote_number} · ${q.status}`, amount: q.price, icon: FileText, color: "text-sky-400" })
    }
    for (const c of containers) {
      if (c.received_at) out.push({ ts: c.received_at, type: "container_received", title: `${c.id} recibido`, subtitle: `${c.vessel} · ${c.items.length} SKUs`, icon: CheckCircle2, color: "text-emerald-400" })
      out.push({ ts: c.eta + "T00:00:00.000Z", type: "container", title: `${c.id} · ETA`, subtitle: `${c.vessel} · ${c.supplier}`, icon: Ship, color: "text-amber-400" })
    }
    return out.filter(e => e.ts).sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? "")).slice(0, max)
  }, [sales, quotes, containers, max])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Actividad reciente</CardTitle>
        <CardDescription>Eventos de ventas, cotizaciones y containers</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className={`mt-0.5 rounded-full p-1.5 bg-muted ${e.color}`}><e.icon className="h-3.5 w-3.5" /></div>
              <div className="flex-1 min-w-0">
                <div className="text-sm leading-tight">{e.title}</div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{e.subtitle}{e.amount ? ` · ${fmtMoney(e.amount)}` : ""}</div>
              </div>
              <div className="text-[10px] text-muted-foreground shrink-0 mt-1">{fmtAgo(e.ts)}</div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
