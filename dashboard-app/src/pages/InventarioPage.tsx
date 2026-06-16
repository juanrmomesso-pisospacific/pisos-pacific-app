import { useMemo, useState } from "react"
import { Plus, Download, Upload, Search, ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TopbarActions } from "@/contexts/TopbarActionsContext"
import { ProductForm } from "@/components/forms/ProductForm"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtMoney, fmtInt, cn } from "@/lib/utils"
import { downloadCSV } from "@/lib/export"
import type { Product } from "@/lib/types"

// Stock-tracked categories — pisos + deck
const STOCK_CATEGORIES = ["Pisos H2O", "Pisos de Madera", "Deck"] as const
const STOCK_FILTERS    = ["Todas", ...STOCK_CATEGORIES] as const
// Everything else lives in Extras (no stock tracking) — zócalos, terminaciones, servicios
const EXTRAS_CATEGORIES = ["Zócalos", "Terminaciones", "Servicio", "Extras"] as const
const EXTRAS_FILTERS    = ["Todas", ...EXTRAS_CATEGORIES] as const
const ACTIVE_FILTERS    = ["Todos", "Activos", "Inactivos"] as const
type ActiveFilter = (typeof ACTIVE_FILTERS)[number]

// Orden por columnas — compartido entre Inventario y Extras
type SortKey = "sku" | "name" | "category" | "cost" | "price" | "margin" | "stock" | "committed" | "available"
const reservedOf  = (p: Product) => Number(p.committed ?? p.reservedStock) || 0
const availableOf = (p: Product) => (Number(p.stock) || 0) - reservedOf(p)
function cmpProducts(a: Product, b: Product, key: SortKey): number {
  switch (key) {
    case "sku":       return a.sku.localeCompare(b.sku, undefined, { numeric: true })
    case "name":      return a.name.localeCompare(b.name)
    case "category":  return a.category.localeCompare(b.category)
    case "cost":      return (a.cost || 0) - (b.cost || 0)
    case "price":     return (a.price || 0) - (b.price || 0)
    case "margin":    return (a.margin || 0) - (b.margin || 0)
    case "stock":     return (Number(a.stock) || 0) - (Number(b.stock) || 0)
    case "committed": return reservedOf(a) - reservedOf(b)
    case "available": return availableOf(a) - availableOf(b)
  }
}

type SortProps = { sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (k: SortKey) => void }
function SortHead({ k, children, align, sortKey, sortDir, onSort }: { k: SortKey; children: React.ReactNode; align?: "right" } & SortProps) {
  const Icon = sortKey !== k ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn(align === "right" && "text-right")}>
      <button onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sortKey === k ? "text-foreground" : "text-muted-foreground")}>
        {align === "right" && <Icon className="h-3 w-3" />}{children}{align !== "right" && <Icon className="h-3 w-3" />}
      </button>
    </TableHead>
  )
}

// Toggle activo/inactivo — los inactivos no ensucian dashboard ni alertas de stock.
function ActiveToggle({ p }: { p: Product }) {
  const update = useAction(api.update)
  const active = p.active !== false
  return (
    <button
      type="button"
      disabled={update.busy}
      onClick={async (e) => { e.stopPropagation(); const r = await update.run("products", p.id, { active: !active }); if (r) refresh() }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 h-6 text-[10px] border transition-colors",
        active ? "border-emerald-500/40 text-emerald-700 hover:bg-emerald-50" : "border-border text-muted-foreground hover:bg-muted",
      )}
      title={active ? "Activo — click para desactivar" : "Inactivo — click para activar"}
    >
      <span className={cn("inline-block h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      {active ? "Activo" : "Inactivo"}
    </button>
  )
}

type View = "inventario" | "extras"

export default function InventarioPage() {
  const products = useApi<Product[]>("/api/products").data ?? []
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "inventario"
    const saved = window.localStorage.getItem("inventario:view")
    return saved === "extras" ? "extras" : "inventario"
  })
  const setViewPersist = (v: View) => {
    setView(v)
    if (typeof window !== "undefined") window.localStorage.setItem("inventario:view", v)
  }
  const [filter, setFilter] = useState<string>("Todas")
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("Todos")
  const [q, setQ] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(k); setSortDir(["sku", "name", "category"].includes(k) ? "asc" : "desc") }
  }

  // Reset category filter when switching tabs so we don't carry an orphan choice across
  const switchView = (v: View) => { setViewPersist(v); setFilter("Todas") }

  const isStockView = view === "inventario"
  const allowedCats = isStockView ? STOCK_CATEGORIES : EXTRAS_CATEGORIES
  const filters = isStockView ? STOCK_FILTERS : EXTRAS_FILTERS

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return products.filter((p) => {
      if (!(allowedCats as readonly string[]).includes(p.category)) return false
      if (filter !== "Todas" && p.category !== filter) return false
      const active = p.active !== false
      if (activeFilter === "Activos" && !active) return false
      if (activeFilter === "Inactivos" && active) return false
      if (!needle) return true
      return p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)
    })
  }, [products, filter, activeFilter, q, allowedCats])

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => cmpProducts(a, b, sortKey) * dir)
  }, [rows, sortKey, sortDir])

  const sortProps: SortProps = { sortKey, sortDir, onSort }

  // Export: planilla para control de stock físico (con columnas en blanco para el depósito).
  const onExport = () => {
    const today = new Date().toISOString().slice(0, 10)
    if (isStockView) {
      const headers = ["SKU", "Nombre", "Categoría", "Stock sistema (m²)", "Cotizado (m²)", "Disponible (m²)", "Conteo físico", "Diferencia", "Observaciones"]
      const body = sorted.map(p => [p.sku, p.name, p.category, Number(p.stock) || 0, reservedOf(p), availableOf(p), "", "", ""])
      downloadCSV(`control-stock-${today}.csv`, headers, body)
    } else {
      const headers = ["SKU", "Nombre", "Categoría", "Costo", "Precio", "Moneda", "Margen %"]
      const body = sorted.map(p => [p.sku, p.name, p.category, p.cost, p.price, p.currency, Math.round(p.margin || 0)])
      downloadCSV(`extras-${today}.csv`, headers, body)
    }
  }

  const summary = useMemo(() => {
    const stockProducts  = products.filter(p => (STOCK_CATEGORIES as readonly string[]).includes(p.category))
    const extrasProducts = products.filter(p => (EXTRAS_CATEGORIES as readonly string[]).includes(p.category))
    const totalStock    = stockProducts.reduce((s, p) => s + (Number(p.stock) || 0), 0)
    const totalReserved = stockProducts.reduce((s, p) => s + (Number(p.committed ?? p.reservedStock) || 0), 0)
    return {
      stockCount: stockProducts.length,
      extrasCount: extrasProducts.length,
      totalStock, totalReserved,
    }
  }, [products])

  const [openNew, setOpenNew] = useState(false)

  return (
    <>
      <TopbarActions>
        <Button variant="outline" size="sm" onClick={onExport} title="Descargar planilla CSV para control de stock"><Download className="h-4 w-4" />Exportar</Button>
        <Button variant="outline" size="sm"><Upload className="h-4 w-4" />Importar</Button>
        <Button size="sm" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4" />Nuevo Ítem</Button>
      </TopbarActions>

      <div className="px-4 lg:px-6 grid grid-cols-2 @xl/main:grid-cols-4 gap-3">
        <SummaryTile label="Productos con stock" value={fmtInt(summary.stockCount)} />
        <SummaryTile label="m² disponibles"      value={fmtInt(summary.totalStock - summary.totalReserved)} />
        <SummaryTile label="m² cotizados"        value={fmtInt(summary.totalReserved)} />
        <SummaryTile label="Extras (sin stock)"  value={fmtInt(summary.extrasCount)} />
      </div>

      <div className="px-4 lg:px-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={view} onValueChange={(v) => switchView(v as View)}>
            <TabsList className="h-8">
              <TabsTrigger value="inventario">Inventario <span className="ml-1.5 text-muted-foreground tabular">{summary.stockCount}</span></TabsTrigger>
              <TabsTrigger value="extras">Extras <span className="ml-1.5 text-muted-foreground tabular">{summary.extrasCount}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o SKU…" className="pl-8 h-8" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {filters.map((c) => (
            <Button key={c} size="sm" variant={c === filter ? "default" : "outline"} onClick={() => setFilter(c)} className="h-8 px-3 text-xs">{c}</Button>
          ))}
          <div className="mx-1 h-5 w-px bg-border" />
          {ACTIVE_FILTERS.map((a) => (
            <Button key={a} size="sm" variant={a === activeFilter ? "default" : "outline"} onClick={() => setActiveFilter(a)} className="h-8 px-3 text-xs">{a}</Button>
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">{sorted.length} ítem{sorted.length === 1 ? "" : "s"}</span>
        </div>

        <Card className="overflow-hidden py-0">
          {isStockView ? <StockTable rows={sorted} {...sortProps} /> : <ExtrasTable rows={sorted} {...sortProps} />}
        </Card>

        {!isStockView && (
          <div className="text-[11px] text-muted-foreground">
            Los productos de Extras no llevan stock — funcionan como catálogo de servicios + complementos para incluir en cotizaciones.
          </div>
        )}
      </div>
      <ProductForm open={openNew} onOpenChange={setOpenNew} />
    </>
  )
}

function StockTable({ rows, ...sp }: { rows: Product[] } & SortProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead k="sku" {...sp}>SKU</SortHead>
          <SortHead k="name" {...sp}>Nombre</SortHead>
          <SortHead k="category" {...sp}>Categoría</SortHead>
          <SortHead k="cost" align="right" {...sp}>Costo</SortHead>
          <SortHead k="price" align="right" {...sp}>Precio</SortHead>
          <SortHead k="margin" align="right" {...sp}>Margen</SortHead>
          <SortHead k="stock" align="right" {...sp}>Stock</SortHead>
          <SortHead k="committed" align="right" {...sp}>Cotizado</SortHead>
          <SortHead k="available" align="right" {...sp}>Disponible</SortHead>
          <TableHead>Estado</TableHead>
          <TableHead>Activo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => {
          const stock = Number(p.stock) || 0
          const reserved = Number(p.committed ?? p.reservedStock) || 0
          const available = stock - reserved
          const out = stock <= 0
          const oversold = available < 0
          const lowFree = available > 0 && available <= 5
          return (
            <TableRow key={p.id} className={cn(p.active === false && "opacity-50")}>
              <TableCell className="text-muted-foreground tabular text-xs">{p.sku}</TableCell>
              <TableCell className="max-w-[360px] truncate">{p.name}</TableCell>
              <TableCell className="text-muted-foreground text-xs">{p.category}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{fmtMoney(p.cost)}</TableCell>
              <TableCell className="text-right tabular">{fmtMoney(p.price)} <span className="text-xs text-muted-foreground">{p.currency}</span></TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{(() => { const m = Math.round(p.margin || 0); return (m > 0 ? "+" : "") + m + "%" })()}</TableCell>
              <TableCell className={cn("text-right tabular", out && "text-destructive font-medium")}>{fmtInt(stock)}</TableCell>
              <TableCell className="text-right tabular">
                {reserved > 0
                  ? <span className="text-amber-600 font-medium">{fmtInt(reserved)}</span>
                  : <span className="text-muted-foreground">0</span>}
              </TableCell>
              <TableCell className={cn("text-right tabular font-medium", oversold && "text-destructive", lowFree && "text-amber-600")}>{fmtInt(available)}</TableCell>
              <TableCell>
                {out
                  ? <Badge variant="destructive" className="text-[10px]">Sin stock</Badge>
                  : oversold
                    ? <Badge variant="destructive" className="text-[10px]">Sobre-cotizado</Badge>
                    : reserved > 0
                      ? <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700">Cotizado · {fmtInt(reserved)}</Badge>
                      : <Badge variant="muted" className="text-[10px]">OK</Badge>}
              </TableCell>
              <TableCell><ActiveToggle p={p} /></TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function ExtrasTable({ rows, ...sp }: { rows: Product[] } & SortProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHead k="sku" {...sp}>SKU</SortHead>
          <SortHead k="name" {...sp}>Nombre</SortHead>
          <SortHead k="category" {...sp}>Categoría</SortHead>
          <SortHead k="cost" align="right" {...sp}>Costo</SortHead>
          <SortHead k="price" align="right" {...sp}>Precio</SortHead>
          <SortHead k="margin" align="right" {...sp}>Margen</SortHead>
          <TableHead>Activo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id} className={cn(p.active === false && "opacity-50")}>
            <TableCell className="text-muted-foreground tabular text-xs">{p.sku}</TableCell>
            <TableCell className="max-w-[360px] truncate">{p.name}</TableCell>
            <TableCell className="text-muted-foreground text-xs">{p.category}</TableCell>
            <TableCell className="text-right tabular text-muted-foreground">{fmtMoney(p.cost)}</TableCell>
            <TableCell className="text-right tabular">{fmtMoney(p.price)} <span className="text-xs text-muted-foreground">{p.currency}</span></TableCell>
            <TableCell className="text-right tabular text-muted-foreground">{(() => { const m = Math.round(p.margin || 0); return (m > 0 ? "+" : "") + m + "%" })()}</TableCell>
            <TableCell><ActiveToggle p={p} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
