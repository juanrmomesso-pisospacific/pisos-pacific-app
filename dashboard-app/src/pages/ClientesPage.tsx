import { useMemo, useState } from "react"
import { Plus, Search, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { fmtMoney, cn } from "@/lib/utils"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { ClientForm } from "@/components/forms/ClientForm"
import type { Sale } from "@/lib/types"

type Client = {
  id: string
  name: string
  emails: string[]
  phones: string[]
  addresses: string[]
  dni: string
  type: string
  updated_at: string
}

type Row = Client & { ventas: number; total: number; saldo: number; lastDate: string; contacto: string }
type SortKey = "name" | "dni" | "ventas" | "total" | "saldo"

const saldoDue = (s: Sale) => s.cashflow_balance_due ?? s.financial_position?.balance_due ?? 0

export default function ClientesPage() {
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const [q, setQ] = useState("")
  const [onlySaldo, setOnlySaldo] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>("total")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Resumen por cliente desde ventas (cuenta, total, saldo pendiente).
  const byClient = useMemo(() => {
    const m = new Map<string, { ventas: number; total: number; saldo: number; lastDate: string }>()
    for (const s of sales) {
      const k = (s.client_name || "").trim(); if (!k) continue
      const cur = m.get(k) ?? { ventas: 0, total: 0, saldo: 0, lastDate: "" }
      cur.ventas += 1
      cur.total += s.contract_total || 0
      const due = saldoDue(s); if (due > 0.5) cur.saldo += due
      if (!cur.lastDate || (s.created_at || "") > cur.lastDate) cur.lastDate = s.created_at || ""
      m.set(k, cur)
    }
    return m
  }, [sales])

  // Unión clientes maestro + los que aparecen en ventas pero no están cargados.
  const allRows = useMemo<Row[]>(() => {
    const known = new Set(clients.map(c => (c.name || "").trim()))
    const base: Row[] = clients.map(c => {
      const s = byClient.get((c.name || "").trim())
      return { ...c, ventas: s?.ventas ?? 0, total: s?.total ?? 0, saldo: s?.saldo ?? 0, lastDate: s?.lastDate ?? "", contacto: c.emails?.[0] || c.phones?.[0] || "" }
    })
    const extras: Row[] = [...byClient.entries()].filter(([name]) => !known.has(name)).map(([name, s]) => ({
      id: "sales:" + name, name, emails: [], phones: [], addresses: [], dni: "", type: "client", updated_at: "",
      ventas: s.ventas, total: s.total, saldo: s.saldo, lastDate: s.lastDate, contacto: "",
    }))
    return [...base, ...extras]
  }, [clients, byClient])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const out = allRows.filter(r => {
      if (onlySaldo && r.saldo <= 0.5) return false
      if (!needle) return true
      return r.name.toLowerCase().includes(needle) || (r.dni ?? "").includes(needle)
    })
    const dir = sortDir === "asc" ? 1 : -1
    out.sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir
      if (sortKey === "dni") return (a.dni || "").localeCompare(b.dni || "") * dir
      return ((a[sortKey] as number) - (b[sortKey] as number)) * dir
    })
    return out
  }, [allRows, q, onlySaldo, sortKey, sortDir])

  const totalSaldo = useMemo(() => rows.reduce((s, r) => s + r.saldo, 0), [rows])
  const sortBy = (k: SortKey) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir(k === "name" || k === "dni" ? "asc" : "desc") } }
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

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo cliente</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">{rows.length} clientes{onlySaldo ? " con saldo" : ""} · por cobrar {fmtMoney(totalSaldo)}</div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={onlySaldo ? "default" : "outline"} className="h-8 text-xs" onClick={() => setOnlySaldo(v => !v)}>Con saldo</Button>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o DNI…" className="pl-8 h-8" />
            </div>
          </div>
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortH k="name">Nombre</SortH>
                <SortH k="dni">DNI</SortH>
                <TableHead>Contacto</TableHead>
                <SortH k="ventas" align="right"># Ventas</SortH>
                <SortH k="total" align="right">Total facturado</SortH>
                <SortH k="saldo" align="right">Saldo</SortH>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Sin clientes para mostrar</TableCell></TableRow>
              ) : rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="font-medium">{c.name}</div>
                    {c.addresses?.[0] ? <div className="text-xs text-muted-foreground truncate max-w-[280px]">{c.addresses[0]}</div> : null}
                    {c.id.startsWith("sales:") ? <Badge variant="muted" className="text-[9px] mt-0.5">solo en ventas</Badge> : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular">{c.dni || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.contacto || "—"}</TableCell>
                  <TableCell className="text-right tabular">{c.ventas || 0}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{c.total ? fmtMoney(c.total) : "—"}</TableCell>
                  <TableCell className={cn("text-right tabular font-medium", c.saldo > 0.5 ? "text-amber-700" : "text-muted-foreground")}>{c.saldo > 0.5 ? fmtMoney(c.saldo) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <ClientForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}
