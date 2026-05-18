import { useMemo, useState } from "react"
import { Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { fmtMoney } from "@/lib/utils"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { ExpenseForm } from "@/components/forms/ExpenseForm"

type Expense = {
  id: string
  date: string
  payment_date: string
  category: string
  subcategory: string
  description: string
  payment_method: string
  fixed_variable: string
  sale_reference: string
  amount: number
  amount_usd: number
  exchange_rate: number
  receiver: string
  created_at: string
}

export default function GastosPage() {
  const expenses = useApi<Expense[]>("/api/expenses").data ?? []
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<string>("Todas")

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const e of expenses) if (e.category) set.add(e.category)
    return ["Todas", ...[...set].sort()]
  }, [expenses])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...expenses]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .filter((row) => {
        if (filter !== "Todas" && row.category !== filter) return false
        if (!needle) return true
        return (row.description?.toLowerCase().includes(needle) || row.receiver?.toLowerCase().includes(needle) || row.subcategory?.toLowerCase().includes(needle))
      })
      .slice(0, 200)
  }, [expenses, filter, q])

  const total = useMemo(() => rows.reduce((s, e) => s + (e.amount || 0), 0), [rows])
  const totalUsd = useMemo(() => rows.reduce((s, e) => s + (e.amount_usd || 0), 0), [rows])

  const [openNew, setOpenNew] = useState(false)

  // expose summary in a small status strip above the table card
  const summaryLine = `${expenses.length} registros · mostrando ${rows.length} · total filtrado ${fmtMoney(total)} (USD ${fmtMoney(totalUsd)})`

  return (
    <>
      <TopbarActions>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo gasto</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 text-xs text-muted-foreground -mb-2">{summaryLine}</div>
      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1 max-w-[60%]">
            {categories.slice(0, 7).map((c) => (
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
                <TableHead>Categoría</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs text-muted-foreground tabular">{r.date}</TableCell>
                  <TableCell className="text-xs"><div>{r.category}</div><div className="text-muted-foreground">{r.subcategory}</div></TableCell>
                  <TableCell className="max-w-[320px] truncate"><div>{r.description}</div><div className="text-xs text-muted-foreground truncate">{r.receiver}</div></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.payment_method}</TableCell>
                  <TableCell className="text-right tabular">{fmtMoney(r.amount)}</TableCell>
                  <TableCell className="text-right tabular text-muted-foreground">{fmtMoney(r.amount_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
      <ExpenseForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}
