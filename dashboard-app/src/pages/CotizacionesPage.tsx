import { useMemo, useState } from "react"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { QuoteRowActions, StatusBadge } from "@/components/RowActions"
import { QuoteForm } from "@/components/forms/QuoteForm"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
import { vigenciaState } from "@/lib/vigencia"
import type { Quote } from "@/lib/types"

// Data uses ENGLISH statuses (DRAFT/SENT/ACCEPTED/REJECTED) but the UI shows Spanish labels.
// canon() normalizes any input to the data form so filters work either way.
const STATUS_ORDER = ["Borrador", "Enviado", "Aceptado"] as const
const SPANISH_TO_DATA: Record<string, string> = { Borrador: "DRAFT", Enviado: "SENT", Aceptado: "ACCEPTED", Rechazado: "REJECTED" }
function canonStatus(s: string): string { return SPANISH_TO_DATA[s] ?? s }

export default function CotizacionesPage() {
  const quotes = useApi<Quote[]>("/api/quotes").data ?? []
  const [filter, setFilter] = useState<"Todas" | (typeof STATUS_ORDER)[number]>("Todas")
  const [q, setQ] = useState("")

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...quotes]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .filter((row) => {
        if (filter !== "Todas" && canonStatus(row.status) !== canonStatus(filter)) return false
        if (!needle) return true
        return row.client_name.toLowerCase().includes(needle) || row.quote_number.toLowerCase().includes(needle)
      })
  }, [quotes, filter, q])

  const counts = useMemo(() => {
    const c: Record<string, number> = { Todas: quotes.length, Borrador: 0, Enviado: 0, Aceptado: 0 }
    const reverse: Record<string, string> = { DRAFT: "Borrador", SENT: "Enviado", ACCEPTED: "Aceptado" }
    for (const q of quotes) {
      const key = reverse[q.status] ?? q.status
      c[key] = (c[key] || 0) + 1
    }
    return c
  }, [quotes])

  const [openNew, setOpenNew] = useState(false)
  const [editing, setEditing] = useState<Quote | null>(null)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nueva Cotización</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {(["Todas", ...STATUS_ORDER] as const).map((s) => (
              <Button key={s} size="sm" variant={s === filter ? "default" : "outline"} onClick={() => setFilter(s)} className="h-8 px-3 text-xs">
                {s} <span className="ml-1 text-muted-foreground">{counts[s] ?? 0}</span>
              </Button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o nº…" className="pl-8 h-8" />
          </div>
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} onClick={() => setEditing(r)} className="cursor-pointer">
                  <TableCell className="text-muted-foreground tabular">#{r.quote_number}</TableCell>
                  <TableCell><div className="truncate max-w-[280px]">{r.client_name}</div><div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.seller_name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString("es-AR") : "—"}
                    {r.renewed_at && <div className="text-[10px]">Renovada {new Date(r.renewed_at).toLocaleDateString("es-AR")}</div>}
                  </TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell><VigenciaBadge quote={r} /></TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(r.price)}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}><QuoteRowActions quote={r} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <QuoteForm open={openNew} onOpenChange={setOpenNew} />
      {editing && <QuoteForm key={editing.id} open onOpenChange={(o) => !o && setEditing(null)} editQuote={editing} />}
    </>
  )
}

function VigenciaBadge({ quote }: { quote: Quote }) {
  const v = vigenciaState(quote)
  if (v.kind === "n/a") return <span className="text-[10px] text-muted-foreground">—</span>
  if (v.kind === "vigente")    return <Badge variant="muted" className="text-[10px]">Vigente · {v.daysLeft}d</Badge>
  if (v.kind === "por-vencer") return <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700">Vence en {v.daysLeft}d</Badge>
  return <Badge variant="destructive" className="text-[10px]">Vencida · {v.daysOverdue}d</Badge>
}
