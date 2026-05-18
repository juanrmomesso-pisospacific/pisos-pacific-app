import { useMemo, useState } from "react"
import { Plus, Download, Upload, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { ProductForm } from "@/components/forms/ProductForm"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { fmtMoney, fmtInt, cn } from "@/lib/utils"
import { groupForCategory, GROUP_ORDER } from "@/lib/groups"
import type { Product } from "@/lib/types"

const CATEGORIES = ["Todas", "Pisos H2O", "Pisos de Madera", "Zócalo", "Deck", "Servicio", "Extras"] as const

export default function InventarioPage() {
  const products = useApi<Product[]>("/api/products").data ?? []
  const [filter, setFilter] = useState<typeof CATEGORIES[number]>("Todas")
  const [q, setQ] = useState("")

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return products.filter((p) => {
      if (filter !== "Todas" && p.category !== filter) return false
      if (!needle) return true
      return p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
    })
  }, [products, filter, q])

  const summary = useMemo(() => {
    const acc = { total: products.length, totalStock: 0, totalReserved: 0, byGroup: { "Pisos H2O": 0, "Pisos de Madera": 0, "Otros": 0 } as Record<string, number> }
    for (const p of products) {
      acc.totalStock += p.stock || 0
      acc.totalReserved += p.reservedStock || 0
      const g = groupForCategory(p.category)
      acc.byGroup[g] += 1
    }
    return acc
  }, [products])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button variant="outline" size="sm"><Download className="h-4 w-4" />Exportar</Button>
        <Button variant="outline" size="sm"><Upload className="h-4 w-4" />Importar</Button>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo Ítem</Button>
      </TopbarActions>
      <div className="px-4 lg:px-6 grid grid-cols-2 @xl/main:grid-cols-4 gap-3">
        <SummaryTile label="Total productos" value={fmtInt(summary.total)} />
        <SummaryTile label="m² disponibles" value={fmtInt(summary.totalStock)} />
        <SummaryTile label="m² reservados" value={fmtInt(summary.totalReserved)} />
        <SummaryTile label="Grupos" value={GROUP_ORDER.map((g) => `${g.replace("Pisos ", "")}: ${summary.byGroup[g]}`).join(" · ")} small />
      </div>

      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <Button key={c} size="sm" variant={c === filter ? "default" : "outline"} onClick={() => setFilter(c)} className="h-8 px-3 text-xs">{c}</Button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o SKU…" className="pl-8 h-8" />
          </div>
        </div>
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const stock = Number(p.stock) || 0
                const reserved = Number(p.reservedStock) || 0
                const out = stock <= 0
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground tabular text-xs">{p.sku}</TableCell>
                    <TableCell className="max-w-[360px] truncate">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{p.category}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{fmtMoney(p.cost)}</TableCell>
                    <TableCell className="text-right tabular">{fmtMoney(p.price)} <span className="text-xs text-muted-foreground">{p.currency}</span></TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">+{Math.round((p.margin || 0))}%</TableCell>
                    <TableCell className={cn("text-right tabular", out && "text-destructive font-medium")}>
                      {fmtInt(stock)}
                      {reserved > 0 ? <span className="text-muted-foreground text-xs"> ({fmtInt(reserved)})</span> : null}
                    </TableCell>
                    <TableCell>
                      {out
                        ? <Badge variant="destructive" className="text-[10px]">Sin stock</Badge>
                        : reserved > stock * 0.5
                          ? <Badge variant="outline" className="text-[10px]">Reservado</Badge>
                          : <Badge variant="muted" className="text-[10px]">OK</Badge>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
      <ProductForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

function SummaryTile({ label, value, small }: { label: string; value: React.ReactNode; small?: boolean }) {
  return (
    <Card className="p-4 gap-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={small ? "text-xs text-muted-foreground" : "text-xl font-semibold serif tabular"}>{value}</div>
    </Card>
  )
}
