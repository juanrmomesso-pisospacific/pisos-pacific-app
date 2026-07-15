import { useMemo, useState } from "react"
import { Search, ArrowUp, ArrowDown, ChevronsUpDown, AlertTriangle, UserPlus, Merge, ChevronDown, ChevronRight } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { api, refresh } from "@/lib/mutations"
import { useConfirm } from "@/components/ui/confirm"
import { cn, appLocale } from "@/lib/utils"
import type { Supplier, CashflowMovement } from "@/lib/types"

type ReviewData = {
  unregistered: { name: string; count: number; total_usd: number; suggestions: { id: string; name: string }[] }[]
  duplicates: { id: string; name: string; count: number }[][]
}

// Sección de revisión: proveedores sin registrar (con sugerencias para vincular) y
// posibles duplicados para unificar. Solo aparece si hay algo que revisar.
function SupplierReview() {
  const confirm = useConfirm()
  const review = useApi<ReviewData>("/api/suppliers/review").data
  const [busy, setBusy] = useState<string | null>(null)
  const [openU, setOpenU] = useState(true)
  const [openD, setOpenD] = useState(false)
  const [keep, setKeep] = useState<Record<number, string>>({})
  if (!review) return null
  const un = review.unregistered ?? []
  const dups = review.duplicates ?? []
  if (!un.length && !dups.length) return null

  const moneyUsd = (n: number) => (n ? "US$ " + Math.round(n).toLocaleString(appLocale()) : "—")

  async function linkTo(name: string, supplier_id: string | undefined, count: number, targetName: string) {
    const ok = await confirm({
      title: supplier_id ? `Vincular a "${targetName}"` : `Crear proveedor "${name}"`,
      description: `Se ${supplier_id ? "vincularán" : "creará el proveedor y se vincularán"} ${count} movimiento(s) a este proveedor.`,
      confirmLabel: "Aplicar",
    })
    if (!ok) return
    setBusy(name)
    try { await api.supplierRegisterLink({ name, supplier_id, learn: !supplier_id, commit: true }); refresh() }
    finally { setBusy(null) }
  }

  async function mergeInto(from: { id: string; name: string; count: number }, to: { id: string; name: string }) {
    const ok = await confirm({
      title: `Unificar "${from.name}" → "${to.name}"`,
      description: `Se moverán ${from.count} movimiento(s) de "${from.name}" a "${to.name}" y se borrará "${from.name}". Verificá que sean el MISMO proveedor (no se deshace fácil).`,
      confirmLabel: "Unificar", destructive: true,
    })
    if (!ok) return
    setBusy(from.id)
    try { await api.supplierMerge({ from_id: from.id, to_id: to.id, commit: true }); refresh() }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-3">
      {un.length > 0 && (
        <Card className="p-0 overflow-hidden border-amber-300/60">
          <button onClick={() => setOpenU(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40">
            {openU ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium">Proveedores sin registrar</span>
            <Badge variant="secondary" className="ml-1">{un.length}</Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">gastos con un proveedor que no está en tu lista</span>
          </button>
          {openU && (
            <div className="divide-y divide-border border-t border-border max-h-[50vh] overflow-y-auto">
              {un.map((u) => (
                <div key={u.name} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{u.name}</div>
                    <div className="text-[11px] text-muted-foreground">{u.count} mov · {moneyUsd(u.total_usd)}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {u.suggestions.map((s) => (
                      <Button key={s.id} variant="outline" size="sm" className="h-7" disabled={busy === u.name}
                        onClick={() => linkTo(u.name, s.id, u.count, s.name)} title={`Vincular a ${s.name}`}>
                        <Merge className="h-3.5 w-3.5" />{s.name}
                      </Button>
                    ))}
                    <Button variant="default" size="sm" className="h-7" disabled={busy === u.name}
                      onClick={() => linkTo(u.name, undefined, u.count, u.name)}>
                      <UserPlus className="h-3.5 w-3.5" />Crear nuevo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {dups.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <button onClick={() => setOpenD(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40">
            {openD ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <Merge className="h-4 w-4 text-sky-600" />
            <span className="text-sm font-medium">Posibles duplicados</span>
            <Badge variant="secondary" className="ml-1">{dups.length}</Badge>
            <span className="ml-auto text-[11px] text-muted-foreground">revisá: pueden ser el mismo o distintos</span>
          </button>
          {openD && (
            <div className="divide-y divide-border border-t border-border">
              {dups.map((group, gi) => {
                const keepId = keep[gi] ?? [...group].sort((a, b) => b.count - a.count)[0].id
                const target = group.find(g => g.id === keepId)!
                return (
                  <div key={gi} className="px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Mantener:</span>
                      <select value={keepId} onChange={(e) => setKeep(k => ({ ...k, [gi]: e.target.value }))}
                        className="h-7 rounded-md border border-input bg-transparent px-2 text-xs">
                        {group.map(g => <option key={g.id} value={g.id}>{g.name} ({g.count})</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {group.filter(g => g.id !== keepId).map((g) => (
                        <Button key={g.id} variant="outline" size="sm" className="h-7" disabled={busy === g.id}
                          onClick={() => mergeInto(g, target)}>
                          <Merge className="h-3.5 w-3.5" />Unificar "{g.name}" ({g.count}) → "{target.name}"
                        </Button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

const usd = (n: number) => (n ? "US$ " + Math.round(n).toLocaleString(appLocale()) : "—")
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
      <SupplierReview />
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
