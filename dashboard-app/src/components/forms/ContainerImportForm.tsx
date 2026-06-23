import { useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { Upload, FileSpreadsheet, X, Plus, Trash2, Check } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchPicker, type PickerItem } from "@/components/SearchPicker"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtInt } from "@/lib/utils"
import { fileToBase64 } from "@/lib/export"
import type { Product } from "@/lib/types"
import { findProductMatch, suggestProducts, aliasIndex, normProd, type ProductAlias } from "@/lib/product-match"

// Una fila editable de la grilla de ítems. La descripción es la CLAVE del match/alias.
type ItemRow = {
  key: string
  product_id: string
  product_name: string
  product_sku: string
  description: string
  quantity: string
  lot: string
  cost: string          // opcional: precio de invoice (NO costo nacionalizado)
}
type DocItem = { file: File; kind: "invoice" | "packing" | "other" }

let rowSeq = 0
const newRow = (patch: Partial<ItemRow> = {}): ItemRow => ({
  key: `r${++rowSeq}`, product_id: "", product_name: "", product_sku: "", description: "", quantity: "", lot: "", cost: "", ...patch,
})

// Auto-parseo best-effort de un Excel/CSV: busca la fila de encabezado (puede NO ser la primera —
// los invoices traen el header en el medio) y extrae descripción / m² / costo / lote / sku.
function parseSheetItems(buf: ArrayBuffer): { description: string; quantity: number; cost: number; lot: string; sku: string }[] {
  const wb = XLSX.read(buf, { type: "array" })
  const out: { description: string; quantity: number; cost: number; lot: string; sku: string }[] = []
  const has = (cell: any, kws: string[]) => { const s = String(cell ?? "").toLowerCase(); return kws.some((k) => s.includes(k)) }
  const QTY = ["m²", "m2", "㎡", "sqm", "metro", "cantidad", "cant", "qty", "quantity", "meter"]
  const DESC = ["descrip", "product", "model", "nombre", "name", "item", "detalle"]
  const COST = ["unit price", "precio", "price", "costo", "cost", "unit"]
  const LOT = ["lot", "lote", "batch", "pallet", "pallte"]
  const SKU = ["sku", "codigo", "code", "ref"]
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: "" })
    // Header = primera fila con una col de descripción Y una de cantidad.
    let hi = -1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      if (r.some((c) => has(c, DESC)) && r.some((c) => has(c, QTY))) { hi = i; break }
    }
    if (hi < 0) continue
    const header = rows[hi]
    const col = (kws: string[]) => header.findIndex((c) => has(c, kws))
    const cDesc = col(DESC), cQty = col(QTY), cCost = col(COST), cLot = col(LOT), cSku = col(SKU)
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i]
      const description = String(r[cDesc] ?? "").replace(/\s+/g, " ").trim()
      const qty = Number(r[cQty]) || 0
      if (!description || qty <= 0) continue                       // saltea totales/sub-tablas/vacíos
      if (/^total/i.test(description) || /^code$/i.test(description)) continue
      out.push({
        description,
        quantity: qty,
        cost: cCost >= 0 ? Number(r[cCost]) || 0 : 0,
        lot: cLot >= 0 ? String(r[cLot] ?? "").trim() : "",
        sku: cSku >= 0 ? String(r[cSku] ?? "").trim() : "",
      })
    }
  }
  return out
}

export function ContainerImportForm({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const products = useApi<Product[]>("/api/products").data ?? []
  const aliases = useApi<ProductAlias[]>("/api/product-aliases").data ?? []

  const today = new Date().toISOString().slice(0, 10)
  const [id, setId] = useState<string>(`A-${Math.floor(Math.random() * 900 + 100)}`)
  const [vessel, setVessel] = useState("")
  const [supplier, setSupplier] = useState("")
  const [etd, setEtd] = useState("")
  const [eta, setEta] = useState(today)
  const [notes, setNotes] = useState("")

  const [items, setItems] = useState<ItemRow[]>([])
  const [docs, setDocs] = useState<DocItem[]>([])
  const [parseNote, setParseNote] = useState("")

  const create = useAction(api.create)

  const aliasIdx = useMemo(() => aliasIndex(aliases), [aliases])
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  // Ítems del buscador (todos los productos) memoizados una vez; las sugerencias por fila solo reordenan.
  const baseItems = useMemo<PickerItem[]>(() => products.map((p) => ({ id: p.id, label: p.name, sub: p.sku, hint: p.category, keywords: p.sku })), [products])

  // Resuelve una fila (por descripción/sku) a un producto existente → la asocia si matchea.
  const resolve = (row: ItemRow): ItemRow => {
    const p = findProductMatch(products, aliasIdx, { sku: row.product_sku || undefined, description: row.description })
    return p ? { ...row, product_id: p.id, product_name: p.name, product_sku: p.sku } : row
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>, parseAsItems: boolean) {
    const f = e.target.files?.[0]
    e.currentTarget.value = ""
    if (!f) return
    if (parseAsItems) {
      try {
        const parsed = parseSheetItems(await f.arrayBuffer())
        if (parsed.length === 0) { setParseNote(`No se detectaron ítems en ${f.name}. Cargalos a mano abajo.`); return }
        const rows = parsed.map((it) => resolve(newRow({ description: it.description, quantity: String(it.quantity), lot: it.lot, cost: it.cost ? String(it.cost) : "", product_sku: it.sku })))
        setItems((prev) => [...prev, ...rows])
        const matched = rows.filter((r) => r.product_id).length
        setParseNote(`${rows.length} ítems de ${f.name} · ${matched} asociados, ${rows.length - matched} a asociar.`)
      } catch (err: any) { setParseNote(`No se pudo leer ${f.name}: ${String(err?.message || err)}`) }
    } else {
      setDocs((prev) => [...prev, { file: f, kind: /invoice|factura|proforma|pi[-_ ]/i.test(f.name) ? "invoice" : /packing/i.test(f.name) ? "packing" : "other" }])
    }
  }

  const setRow = (key: string, patch: Partial<ItemRow>) => setItems((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const removeRow = (key: string) => setItems((prev) => prev.filter((r) => r.key !== key))
  const pickProduct = (key: string, pid: string) => {
    const p = byId.get(pid)
    if (p) setRow(key, { product_id: p.id, product_name: p.name, product_sku: p.sku })
  }

  // Buscador por fila: sugerencias (por descripción) arriba, después el resto (reusa baseItems).
  const pickerItems = (desc: string): PickerItem[] => {
    const sugg = suggestProducts(products, desc)
    if (sugg.length === 0) return baseItems
    const order = new Map(sugg.map((p, i) => [p.id, i]))
    return [...baseItems].sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
  }

  const totalMeters = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)
  const unassigned = items.filter((i) => !i.product_id).length
  const badQty = items.filter((i) => !(Number(i.quantity) > 0)).length
  const headerOk = !!(id && vessel && supplier && eta)
  const canSubmit = headerOk && items.length > 0 && unassigned === 0 && badQty === 0

  async function submit() {
    if (!canSubmit) return
    const body = {
      id, vessel, supplier, etd, eta, notes, status: "in_transit", warehouse_id: "main",
      items: items.map((i) => ({
        product_id: i.product_id, sku: i.product_sku, description: i.description, quantity: Number(i.quantity) || 0,
        ...(i.lot ? { lot: i.lot } : {}),
        ...(Number(i.cost) > 0 ? { unit_cost_usd: Number(i.cost) } : {}),
      })),
    }
    const c = await create.run("containers", body)
    if (!c) return
    // Aprende los alias nuevos (descripción → producto) para futuras importaciones.
    for (const i of items) {
      if (i.description && i.product_id && aliasIdx.get(normProd(i.description)) !== i.product_id) {
        try { await api.productAliasSave(i.description, i.product_id) } catch { /* best-effort */ }
      }
    }
    // Adjunta los documentos (invoice / packing / otros).
    for (const d of docs) {
      try { const b64 = await fileToBase64(d.file); await api.containerAddDocument(c.id, { data_base64: b64, filename: d.file.name, content_type: d.file.type, kind: d.kind }) }
      catch { /* best-effort */ }
    }
    onOpenChange(false); refresh()
  }

  const errMsg = create.error || (items.length > 0 && !canSubmit
    ? `${!headerOk ? "Faltan datos del container. " : ""}${unassigned ? `${unassigned} ítem(s) sin producto asociado. ` : ""}${badQty ? `${badQty} con cantidad 0.` : ""}`.trim()
    : "")

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Nuevo container" description="Cargá los ítems (invoice/packing) y adjuntá los documentos"
      onSubmit={submit} busy={create.busy} error={errMsg}
      submitLabel={items.length === 0 ? "Agregá ítems para cargar" : `Crear container · ${fmtInt(totalMeters)} m²`}>

      <div className="grid grid-cols-2 gap-3">
        <div><FieldLabel>ID container</FieldLabel><Input value={id} onChange={(e) => setId(e.target.value)} placeholder="A-127" /></div>
        <div><FieldLabel>Buque / Vessel</FieldLabel><Input value={vessel} onChange={(e) => setVessel(e.target.value)} placeholder="SEA OF LUCK" /></div>
      </div>
      <div><FieldLabel>Proveedor</FieldLabel><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Hushfloors" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><FieldLabel>ETD (salida)</FieldLabel><Input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} /></div>
        <div><FieldLabel>ETA (arribo)</FieldLabel><Input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
      </div>

      {/* Documentos adjuntos (invoice + packing + otros) */}
      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex items-center justify-between">
          <FieldLabel>Documentos (invoice, packing list…)</FieldLabel>
          <label className="inline-flex items-center gap-1 text-xs text-primary cursor-pointer hover:underline">
            <Upload className="h-3.5 w-3.5" /> Adjuntar
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e, false)} />
          </label>
        </div>
        {docs.length > 0 && (
          <div className="space-y-1">
            {docs.map((d, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-sm">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{d.file.name}</span>
                <select value={d.kind} onChange={(e) => setDocs((prev) => prev.map((x, j) => (j === i ? { ...x, kind: e.target.value as DocItem["kind"] } : x)))}
                  className="h-7 rounded border border-input bg-transparent px-1 text-xs">
                  <option value="invoice">Invoice</option>
                  <option value="packing">Packing</option>
                  <option value="other">Otro</option>
                </select>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ítems a cargar */}
      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex items-center justify-between">
          <FieldLabel>Ítems a cargar</FieldLabel>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1 text-xs text-primary cursor-pointer hover:underline" title="Pre-cargar desde un Excel/CSV estructurado">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Importar Excel/CSV
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => onFile(e, true)} />
            </label>
            <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setItems((prev) => [...prev, newRow()])}><Plus className="h-3.5 w-3.5 mr-1" />Ítem</Button>
          </div>
        </div>
        {parseNote && <div className="text-xs text-muted-foreground">{parseNote}</div>}

        {items.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="muted">{items.length} ítems · {fmtInt(totalMeters)} m²</Badge>
            {unassigned > 0 && <Badge variant="destructive">{unassigned} sin asociar</Badge>}
          </div>
        )}

        <div className="space-y-2">
          {items.map((row) => (
            <div key={row.key} className="rounded-md border border-border p-2 space-y-2">
              <div className="flex items-start gap-2">
                <Input value={row.description} onChange={(e) => setRow(row.key, { description: e.target.value })} placeholder="Descripción del producto (del invoice)" className="text-sm" />
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-muted-foreground" onClick={() => removeRow(row.key)} title="Quitar"><Trash2 className="h-4 w-4" /></Button>
              </div>
              {/* Asociación a producto */}
              {row.product_id ? (
                <div className="flex items-center gap-2 text-sm rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2 py-1.5">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate flex-1">{row.product_name} <span className="text-muted-foreground text-xs">· {row.product_sku}</span></span>
                  <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setRow(row.key, { product_id: "", product_name: "", product_sku: "" })}>Cambiar</Button>
                </div>
              ) : (
                <div>
                  <SearchPicker items={pickerItems(row.description)} placeholder="Asociar a un producto…" onPick={(pid) => pickProduct(row.key, pid)} />
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-0.5">m² *</div>
                  <Input type="number" inputMode="decimal" value={row.quantity} onChange={(e) => setRow(row.key, { quantity: e.target.value })} className="h-8 text-sm" />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-0.5">Lote</div>
                  <Input value={row.lot} onChange={(e) => setRow(row.key, { lot: e.target.value })} className="h-8 text-sm" />
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-0.5">Costo USD (opc.)</div>
                  <Input type="number" inputMode="decimal" value={row.cost} onChange={(e) => setRow(row.key, { cost: e.target.value })} className="h-8 text-sm" placeholder="invoice" />
                </div>
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded-md">
              Importá un Excel/CSV o agregá ítems a mano. El costo nacionalizado se carga aparte.
            </div>
          )}
        </div>
      </div>

      <div><FieldLabel>Notas (opcional)</FieldLabel><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
    </FormSheet>
  )
}
