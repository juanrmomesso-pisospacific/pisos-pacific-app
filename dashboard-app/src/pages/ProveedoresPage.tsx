import { useMemo, useState } from "react"
import { Search, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Supplier, CashflowMovement } from "@/lib/types"

const usd = (n: number) => (n ? "US$ " + Math.round(n).toLocaleString("es-AR") : "—")
const norm = (s?: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim()
// Contrapartes que NO son proveedores (movimientos internos / personales).
const NOT_SUPPLIER = /mov entre|ajuste concil|juan & pipi|^pipi$|cheque|s\/identificar/i
const INSTALLERS = new Set(["hugo ramirez", "ariel noruega", "gaston aguilera", "fabian ortiz", "gaston", "jose", "matias", "matias trejo"])
const typeFromExpense = (et?: string) => {
  if (!et) return "Otros"
  if (/instalaciones/i.test(et)) return "Insumos / Colocación"
  if (/flota/i.test(et)) return "Flota / Logística"
  if (/marketing/i.test(et)) return "Comisiones / Marketing"
  if (/administrativos/i.test(et)) return "Servicios / Admin"
  if (/personal/i.test(et)) return "Personal"
  if (/impuestos/i.test(et)) return "Impuestos"
  return "Otros"
}

type Row = { id: string; name: string; type: string; stock_code?: string | null; active: boolean; notes?: string | null; total: number; count: number; inMaster: boolean }
type SortKey = "name" | "type" | "count" | "total"

export default function ProveedoresPage() {
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const movements = useApi<CashflowMovement[]>("/api/cashflow").data ?? []
  const [q, setQ] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("total")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Gasto por contraparte (nombre normalizado) desde egresos reales del cashflow.
  const spend = useMemo(() => {
    const m = new Map<string, { total: number; count: number; types: Record<string, number>; display: string }>()
    for (const x of movements) {
      if (x.flow !== "Egreso" || x.transfer) continue
      const name = (x.counterparty || "").trim()
      if (!name || NOT_SUPPLIER.test(name)) continue
      const k = norm(name)
      const cur = m.get(k) ?? { total: 0, count: 0, types: {}, display: name }
      cur.total += x.amount_usd || 0; cur.count += 1
      const t = x.expense_type || "?"; cur.types[t] = (cur.types[t] || 0) + 1
      m.set(k, cur)
    }
    return m
  }, [movements])

  // Maestro (curado) UNIÓN contrapartes del cashflow → planilla viva y completa.
  const allRows = useMemo<Row[]>(() => {
    const masterByName = new Map(suppliers.map(s => [norm(s.name), s]))
    const rows: Row[] = suppliers.map(s => {
      const sp = spend.get(norm(s.name))
      return { id: s.id, name: s.name, type: s.type || "—", stock_code: s.stock_code, active: s.active, notes: s.notes, total: sp?.total ?? 0, count: sp?.count ?? 0, inMaster: true }
    })
    for (const [k, sp] of spend) {
      if (masterByName.has(k)) continue
      const topType = Object.entries(sp.types).sort((a, b) => b[1] - a[1])[0]?.[0]
      const type = INSTALLERS.has(k) ? "Colocación / Mano de obra" : typeFromExpense(topType)
      rows.push({ id: "cf:" + k, name: sp.display, type, stock_code: null, active: true, notes: null, total: sp.total, count: sp.count, inMaster: false })
    }
    return rows
  }, [suppliers, spend])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = allRows.filter(s => !needle || s.name.toLowerCase().includes(needle) || s.type.toLowerCase().includes(needle))
    const dir = sortDir === "asc" ? 1 : -1
    out.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir
      if (sortKey === "type") return a.type.localeCompare(b.type) * dir
      return ((a[sortKey] as number) - (b[sortKey] as number)) * dir
    })
    return out
  }, [allRows, q, sortKey, sortDir])

  const totalPagado = useMemo(() => rows.reduce((s, r) => s + r.total, 0), [rows])
  const sortBy = (k: SortKey) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "name" || k === "type" ? "asc" : "desc") } }
  const SortH = ({ k, children, align }: { k: SortKey; children: React.ReactNode; align?: "right" }) => {
    const Icon = sortKey !== k ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
    return (
      <TableHead className={cn(align === "right" && "text-right")}>
        <button onClick={() => sortBy(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sortKey === k ? "text-foreground" : "text-muted-foreground")}>
          {align === "right" && <Icon className="h-3 w-3" />}{children}{align !== "right" && <Icon className="h-3 w-3" />}
        </button>
      </TableHead>
    )
  }

  return (
    <div className="px-4 lg:px-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-muted-foreground">{rows.length} proveedores · total pagado {usd(totalPagado)}</div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o tipo…" className="pl-8 h-8" />
        </div>
      </div>
      <Card className="overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortH k="name">Proveedor</SortH>
              <SortH k="type">Tipo</SortH>
              <TableHead>Cód. stock</TableHead>
              <SortH k="count" align="right"># Pagos</SortH>
              <SortH k="total" align="right">Total pagado (USD)</SortH>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Sin proveedores</TableCell></TableRow>
            ) : rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <div className="font-medium">{s.name}</div>
                  {s.notes ? <div className="text-[11px] text-muted-foreground truncate max-w-[280px]">{s.notes}</div> : null}
                  {!s.inMaster ? <Badge variant="muted" className="text-[9px] mt-0.5">del cashflow</Badge> : !s.active ? <Badge variant="muted" className="text-[9px] mt-0.5">inactivo</Badge> : null}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.type || "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground tabular">{s.stock_code || "—"}</TableCell>
                <TableCell className="text-right tabular text-muted-foreground">{s.count || 0}</TableCell>
                <TableCell className="text-right tabular font-medium">{usd(s.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
