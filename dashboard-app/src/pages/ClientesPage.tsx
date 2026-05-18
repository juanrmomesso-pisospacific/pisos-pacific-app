import { useMemo, useState } from "react"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
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

export default function ClientesPage() {
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const [q, setQ] = useState("")

  const byClient = useMemo(() => {
    const m = new Map<string, { count: number; total: number; lastDate: string }>()
    for (const s of sales) {
      const k = s.client_name
      const cur = m.get(k) ?? { count: 0, total: 0, lastDate: "" }
      cur.count += 1
      cur.total += s.contract_total || 0
      if (!cur.lastDate || s.created_at > cur.lastDate) cur.lastDate = s.created_at
      m.set(k, cur)
    }
    return m
  }, [sales])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return clients
      .filter((c) => {
        if (!needle) return true
        return c.name.toLowerCase().includes(needle) || (c.dni ?? "").includes(needle)
      })
      .slice(0, 200)
  }, [clients, q])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo cliente</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-muted-foreground">Mostrando {rows.length} de {clients.length}</div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o DNI…" className="pl-8 h-8" />
          </div>
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>DNI</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead className="text-right"># Ventas</TableHead>
                <TableHead className="text-right">Total facturado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => {
                const summary = byClient.get(c.name)
                return (
                  <TableRow key={c.id}>
                    <TableCell><div className="font-medium">{c.name}</div>{c.addresses?.[0] ? <div className="text-xs text-muted-foreground truncate max-w-[280px]">{c.addresses[0]}</div> : null}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular">{c.dni || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{c.type || "—"}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.emails?.[0] || c.phones?.[0] || "—"}</TableCell>
                    <TableCell className="text-right tabular">{summary?.count ?? 0}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{summary ? fmtMoney(summary.total) : "—"}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
      <ClientForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}
