import { useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { Upload, FileSpreadsheet, X } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtInt } from "@/lib/utils"
import type { Product } from "@/lib/types"

type Row = Record<string, any>
type Mapping = { sku: string; qty: string; cost: string; lot: string; description: string }
const REQUIRED: (keyof Mapping)[] = ["sku", "qty", "cost"]

export function ContainerImportForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const products = useApi<Product[]>("/api/products").data ?? []

  // Header fields
  const today = new Date().toISOString().slice(0, 10)
  const [id, setId] = useState<string>(`A-${Math.floor(Math.random() * 900 + 100)}`)
  const [vessel, setVessel] = useState("")
  const [supplier, setSupplier] = useState("")
  const [etd, setEtd] = useState("")
  const [eta, setEta] = useState(today)
  const [notes, setNotes] = useState("")

  // Parsed file
  const [filename, setFilename] = useState<string>("")
  const [rows, setRows] = useState<Row[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [mapping, setMapping] = useState<Mapping>({ sku: "", qty: "", cost: "", lot: "", description: "" })

  const create = useAction(api.create)

  // Index products by SKU + name for resolution
  const productBySku = useMemo(() => {
    const m = new Map<string, Product>()
    for (const p of products) m.set(String(p.sku).toLowerCase(), p)
    return m
  }, [products])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFilename(f.name)
    const buf = await f.arrayBuffer()
    const wb = XLSX.read(buf, { type: "array" })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const data = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" })
    if (data.length === 0) {
      setRows([]); setColumns([]); return
    }
    const cols = Object.keys(data[0])
    setRows(data)
    setColumns(cols)
    // Smart-guess mappings by common header names
    const guess = (candidates: string[]) => cols.find(c => candidates.some(k => c.toLowerCase().includes(k))) ?? ""
    setMapping({
      sku:         guess(["sku", "codigo", "code", "ref"]),
      qty:         guess(["qty", "cantidad", "cant", "m2", "meters", "quantity"]),
      cost:        guess(["cost", "costo", "precio", "price", "unit"]),
      lot:         guess(["lot", "lote", "batch"]),
      description: guess(["desc", "name", "nombre", "product"]),
    })
  }

  function clearFile() {
    setFilename(""); setRows([]); setColumns([]); setMapping({ sku: "", qty: "", cost: "", lot: "", description: "" })
  }

  const items = useMemo(() => {
    if (rows.length === 0 || !mapping.sku || !mapping.qty) return []
    return rows.map((r) => {
      const sku = String(r[mapping.sku] ?? "").trim()
      const qty = Number(r[mapping.qty]) || 0
      const cost = Number(r[mapping.cost]) || 0
      const description = mapping.description ? String(r[mapping.description] ?? "") : ""
      const lot = mapping.lot ? String(r[mapping.lot] ?? "") : ""
      const product = productBySku.get(sku.toLowerCase())
      return {
        product_id: product?.id ?? "",
        sku,
        description: description || product?.name || sku,
        quantity: qty,
        unit_cost_usd: cost,
        lot,
        // hint flag used only in the preview UI
        _missing: !product,
        _bad: qty <= 0,
      }
    })
  }, [rows, mapping, productBySku])

  const totalMeters = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const missingCount = items.filter(i => i._missing).length
  const badCount = items.filter(i => i._bad).length
  const allMapped = REQUIRED.every(k => !!mapping[k])
  const canSubmit = id && vessel && supplier && eta && allMapped && items.length > 0 && badCount === 0

  async function submit() {
    if (!canSubmit) return
    const body = {
      id, vessel, supplier, etd, eta, notes,
      status: "in_transit",
      items: items.map(({ _missing, _bad, ...keep }) => keep),
    }
    const r = await create.run("containers", body)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo container" description="Importar packing list desde Google Sheets o Excel"
      onSubmit={submit} busy={create.busy}
      error={create.error || (!canSubmit && items.length > 0 ? `Faltan datos${missingCount ? ` · ${missingCount} SKUs no encontrados` : ""}${badCount ? ` · ${badCount} con qty 0` : ""}` : "")}
      submitLabel={items.length === 0 ? "Subí el packing list" : `Acreditar ${fmtInt(totalMeters)} m² al inventario`}>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>ID container</FieldLabel>
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="A-127" />
        </div>
        <div>
          <FieldLabel>Buque / Vessel</FieldLabel>
          <Input value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="MSC Pacific 14" />
        </div>
      </div>
      <div>
        <FieldLabel>Proveedor</FieldLabel>
        <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Heyu Flooring Co." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>ETD (salida)</FieldLabel>
          <Input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} />
        </div>
        <div>
          <FieldLabel>ETA (arribo)</FieldLabel>
          <Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
      </div>

      <div className="pt-2 border-t border-border">
        <FieldLabel>Packing list (.xlsx, .xls, .csv)</FieldLabel>
        {!filename ? (
          <label className="flex flex-col items-center justify-center gap-1 border-2 border-dashed border-border rounded-md p-6 cursor-pointer hover:bg-muted/40 transition">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Elegir archivo</span>
            <span className="text-xs text-muted-foreground">o arrastrá un Excel/CSV</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
              <span>{filename}</span>
              <Badge variant="muted" className="text-[10px]">{rows.length} filas</Badge>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={clearFile}><X className="h-3.5 w-3.5" /></Button>
          </div>
        )}
      </div>

      {columns.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Mapeá las columnas</div>
          <div className="grid grid-cols-2 gap-3">
            <MapPicker label="SKU *" value={mapping.sku} cols={columns} onChange={(v) => setMapping({ ...mapping, sku: v })} />
            <MapPicker label="Cantidad (m²) *" value={mapping.qty} cols={columns} onChange={(v) => setMapping({ ...mapping, qty: v })} />
            <MapPicker label="Costo USD *" value={mapping.cost} cols={columns} onChange={(v) => setMapping({ ...mapping, cost: v })} />
            <MapPicker label="Lote (opcional)" value={mapping.lot} cols={columns} onChange={(v) => setMapping({ ...mapping, lot: v })} />
            <MapPicker label="Descripción (opcional)" value={mapping.description} cols={columns} onChange={(v) => setMapping({ ...mapping, description: v })} />
          </div>
        </div>
      )}

      {items.length > 0 && allMapped && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Preview ({items.length} items, {fmtInt(totalMeters)} m²)</div>
            <div className="flex gap-1">
              {missingCount > 0 && <Badge variant="destructive" className="text-[10px]">{missingCount} sin SKU</Badge>}
              {badCount > 0 && <Badge variant="destructive" className="text-[10px]">{badCount} qty 0</Badge>}
            </div>
          </div>
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="text-right">m²</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.slice(0, 10).map((it, i) => (
                  <TableRow key={i} className={it._missing || it._bad ? "bg-destructive/5" : ""}>
                    <TableCell className="text-xs tabular">{it.sku}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate">{it.description}{it._missing ? <span className="text-destructive text-[10px] ml-1">SKU no encontrado</span> : null}</TableCell>
                    <TableCell className="text-right tabular text-xs">{fmtInt(it.quantity)}</TableCell>
                    <TableCell className="text-right tabular text-xs">${it.unit_cost_usd.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {items.length > 10 && <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border">+ {items.length - 10} filas más</div>}
          </div>
        </div>
      )}

      <div>
        <FieldLabel>Notas (opcional)</FieldLabel>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </FormSheet>
  )
}

function MapPicker({ label, value, cols, onChange }: { label: string; value: string; cols: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
        <option value="">— Sin mapear —</option>
        {cols.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )
}
