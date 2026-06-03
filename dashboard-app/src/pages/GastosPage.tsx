import { useMemo, useState } from "react"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { CashflowForm } from "@/components/forms/CashflowForm"
import type { CashflowMovement, Caja } from "@/lib/types"

const usd = (n: number) => "US$ " + Math.round(n).toLocaleString("es-AR")
const ars = (n: number) => (n ? "$ " + Math.round(n).toLocaleString("es-AR") : "—")

export default function GastosPage() {
  const movements = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const cajas = useApi<Caja[]>("/api/cajas").data ?? []
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("Todas")
  const [openNew, setOpenNew] = useState(false)

  // Real expenses only — exclude inter-account transfers.
  const expenses = useMemo(() => movements.filter((m) => m.flow === "Egreso" && !m.transfer), [movements])

  const types = useMemo(() => {
    const set = new Set<string>()
    for (const e of expenses) if (e.expense_type) set.add(e.expense_type)
    return ["Todas", ...[...set].sort()]
  }, [expenses])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...expenses]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .filter((row) => {
        if (filter !== "Todas" && row.expense_type !== filter) return false
        if (!needle) return true
        return (row.description?.toLowerCase().includes(needle) || row.counterparty?.toLowerCase().includes(needle) || row.category?.toLowerCase().includes(needle)) ?? false
      })
      .slice(0, 300)
  }, [expenses, filter, q])

  const totalUsd = useMemo(() => rows.reduce((s, e) => s + (e.amount_usd || 0), 0), [rows])

  // Operational KPIs: most recent month with data + current year.
  const kpis = useMemo(() => {
    const months = expenses.map((e) => e.date?.slice(0, 7)).filter(Boolean).sort() as string[]
    const lastMonth = months[months.length - 1] ?? ""
    const year = lastMonth.slice(0, 4)
    const sum = (pred: (e: CashflowMovement) => boolean) => expenses.filter(pred).reduce((s, e) => s + (e.amount_usd || 0), 0)
    return {
      lastMonth,
      monthTotal: sum((e) => (e.date ?? "").slice(0, 7) === lastMonth),
      yearTotal: sum((e) => (e.date ?? "").slice(0, 4) === year),
      year,
    }
  }, [expenses])

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo egreso</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <p className="text-xs text-muted-foreground">Carga y seguimiento de egresos del día a día. Para el análisis (P&amp;L, fijo/variable, ingresos) usá <b>CashFlow</b>.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4"><div className="text-xs text-muted-foreground">Egresos {kpis.lastMonth || "—"}</div><div className="text-2xl font-semibold tabular">{usd(kpis.monthTotal)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Egresos {kpis.year || "año"}</div><div className="text-2xl font-semibold tabular">{usd(kpis.yearTotal)}</div></Card>
          <Card className="p-4"><div className="text-xs text-muted-foreground">Total registrados</div><div className="text-2xl font-semibold tabular">{expenses.length}</div></Card>
        </div>
        <div className="text-xs text-muted-foreground">Mostrando {rows.length} de {expenses.length} · total filtrado {usd(totalUsd)}</div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 max-w-[65%]">
            {types.slice(0, 8).map((c) => (
              <Button key={c} size="sm" variant={c === filter ? "default" : "outline"} onClick={() => setFilter(c)} className="h-8 px-3 text-xs">{c}</Button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar descripción o proveedor…" className="pl-8 h-8" />
          </div>
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo de gasto</TableHead>
                <TableHead>Descripción / Proveedor</TableHead>
                <TableHead>Caja</TableHead>
                <TableHead>Fijo/Var</TableHead>
                <TableHead className="text-right">USD</TableHead>
                <TableHead className="text-right">ARS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs text-muted-foreground tabular whitespace-nowrap">{r.date?.slice(0, 10)}</TableCell>
                  <TableCell className="text-xs"><div>{r.expense_type || "—"}</div><div className="text-muted-foreground">{r.category}{r.subcategory ? ` · ${r.subcategory}` : ""}</div></TableCell>
                  <TableCell className="max-w-[320px] truncate"><div className="text-sm">{r.description || "—"}</div><div className="text-xs text-muted-foreground truncate">{r.counterparty}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.caja_name || "—"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px] font-normal">{r.fixed_variable || "—"}</Badge></TableCell>
                  <TableCell className="text-right tabular">{usd(r.amount_usd || 0)}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{ars(r.amount_ars || 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <CashflowForm open={openNew} onOpenChange={setOpenNew} cajas={cajas} />
    </>
  )
}
