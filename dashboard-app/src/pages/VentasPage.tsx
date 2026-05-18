import { useMemo, useState } from "react"
import { Search, LayoutGrid, Rows3, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { SaleRowActions } from "@/components/RowActions"
import { SaleForm } from "@/components/forms/SaleForm"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
import type { Sale } from "@/lib/types"

const STATUSES = ["Confirmado", "Programado", "En proceso", "Finalizado"] as const

type View = "tabla" | "kanban"

export default function VentasPage() {
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const [filter, setFilter] = useState<"Todas" | (typeof STATUSES)[number]>("Todas")
  const [q, setQ] = useState("")
  const [view, setView] = useState<View>("tabla")

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...sales]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .filter((row) => {
        if (filter !== "Todas" && row.status !== filter) return false
        if (!needle) return true
        return row.client_name.toLowerCase().includes(needle) || row.quote_number.toLowerCase().includes(needle)
      })
  }, [sales, filter, q])

  const counts = useMemo(() => {
    const c: Record<string, number> = { Todas: sales.length }
    for (const s of STATUSES) c[s] = 0
    for (const s of sales) c[s.status] = (c[s.status] || 0) + 1
    return c
  }, [sales])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Agregar venta</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {(["Todas", ...STATUSES] as const).map((s) => (
              <Button key={s} size="sm" variant={s === filter ? "default" : "outline"} onClick={() => setFilter(s)} className="h-8 px-3 text-xs">
                {s} <span className="ml-1 text-muted-foreground">{counts[s] ?? 0}</span>
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Tabs value={view} onValueChange={(v) => setView(v as View)}>
              <TabsList className="h-8">
                <TabsTrigger value="tabla" className="gap-1.5"><Rows3 className="h-3.5 w-3.5" />Tabla</TabsTrigger>
                <TabsTrigger value="kanban" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" />Kanban</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente o nº…" className="pl-8 h-8" />
            </div>
          </div>
        </div>
        {view === "tabla" ? (
          <Card className="overflow-hidden py-0"><VentasTable rows={filtered} /></Card>
        ) : (
          <VentasKanban rows={filtered} />
        )}
      </div>
      <SaleForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

function VentasTable({ rows }: { rows: Sale[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
          <TableHead>Stock</TableHead>
          <TableHead className="text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const due = r.financial_position?.balance_due ?? 0
          return (
            <TableRow key={r.id}>
              <TableCell className="text-muted-foreground tabular">#{r.quote_number}</TableCell>
              <TableCell><div className="truncate max-w-[280px]">{r.client_name}</div><div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div></TableCell>
              <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("es-AR")}</TableCell>
              <TableCell className="text-right tabular">{fmtMoney(r.contract_total)}</TableCell>
              <TableCell className={`text-right tabular ${due > 0 ? "text-foreground" : "text-muted-foreground"}`}>{fmtMoney(due)}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {r.stock_deducted ? "Entregado" : r.stock_reserved ? "Reservado" : "—"}
              </TableCell>
              <TableCell className="text-right"><SaleRowActions sale={r} /></TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function VentasKanban({ rows }: { rows: Sale[] }) {
  const byStatus = useMemo(() => {
    const m: Record<string, Sale[]> = { Confirmado: [], Programado: [], "En proceso": [], Finalizado: [] }
    for (const r of rows) (m[r.status] ??= []).push(r)
    return m
  }, [rows])

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      {STATUSES.map((status) => {
        const list = byStatus[status] ?? []
        const total = list.reduce((s, r) => s + (r.contract_total || 0), 0)
        return (
          <div key={status} className="bg-muted/40 rounded-lg border border-border flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <div className="text-xs font-medium uppercase tracking-wide flex items-center gap-2">
                {status}
                <Badge variant="muted" className="text-[10px]">{list.length}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground tabular">{fmtMoney(total)}</div>
            </div>
            <div className="flex flex-col gap-2 p-2 min-h-[120px] max-h-[640px] overflow-y-auto">
              {list.length === 0 ? <div className="text-xs text-muted-foreground text-center py-6">Sin ventas</div> : list.map((r) => {
                const due = r.financial_position?.balance_due ?? 0
                return (
                  <div key={r.id} className="bg-card border border-border rounded-md p-3 hover:bg-accent transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="text-sm font-medium truncate flex-1">{r.client_name}</div>
                      <SaleRowActions sale={r} />
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular">#{r.quote_number}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2 my-2">{r.description}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="tabular text-foreground">{fmtMoney(r.contract_total)}</span>
                      {due > 0 ? <Badge variant="outline" className="text-[10px]">Saldo {fmtMoney(due)}</Badge> : <span className="text-muted-foreground tabular">{new Date(r.created_at).toLocaleDateString("es-AR")}</span>}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      {r.stock_deducted ? "Stock entregado" : r.stock_reserved ? "Stock reservado" : "Sin reserva"}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
