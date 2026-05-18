import { useMemo, useState } from "react"
import { Plus, Trash2, Sparkles } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtMoney } from "@/lib/utils"
import type { Product, Quote } from "@/lib/types"

type Settings = { sellers?: { name: string; phone?: string }[] }
type Client = { id: string; name: string; dni: string; phones?: string[]; emails?: string[]; addresses?: string[] }
type LineItem = { product_id: string; sku: string; description: string; quantity: number; unit_price: number; category: string }

export type QuotePrefill = {
  lead_id?: string
  client_name: string
  client_phone?: string
  client_email?: string
  client_address?: string
  title?: string
  internal_notes?: string
  source?: string  // shown as a small "desde {source}" hint
}

const IVA_RATE = 0.21

export function QuoteForm({ open, onOpenChange, prefill, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; prefill?: QuotePrefill; onCreated?: (q: Quote) => void | Promise<void> }) {
  const clients = useApi<Client[]>("/api/clients").data ?? []
  const products = useApi<Product[]>("/api/products").data ?? []
  const settings = useApi<Settings>("/api/settings").data
  const sellers = settings?.sellers ?? []

  const [clientId, setClientId] = useState<string>("")
  const [seller, setSeller] = useState<string>(sellers[0]?.name ?? "")
  const [title, setTitle] = useState<string>(prefill?.title ?? "")
  const [internalNotes, setInternalNotes] = useState<string>(prefill?.internal_notes ?? "")
  const [hasIva, setHasIva] = useState<boolean>(false)
  const [items, setItems] = useState<LineItem[]>([])

  const client = clients.find(c => c.id === clientId)
  const create = useAction(api.create)
  const isLeadDriven = !!prefill

  const subtotal = useMemo(() => items.reduce((s, i) => s + (i.quantity * i.unit_price), 0), [items])
  const iva = hasIva ? subtotal * IVA_RATE : 0
  const total = subtotal + iva

  function addItem() {
    setItems([...items, { product_id: "", sku: "", description: "", quantity: 1, unit_price: 0, category: "" }])
  }
  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx))
  }
  function pickProduct(idx: number, productId: string) {
    const p = products.find(x => x.id === productId)
    if (!p) return
    updateItem(idx, { product_id: p.id, sku: p.sku, description: p.name, unit_price: p.price, category: p.category })
  }

  async function submit() {
    if (items.length === 0) return
    if (!isLeadDriven && !client) return
    const seller_phone = sellers.find(s => s.name === seller)?.phone ?? ""

    // Resolve client info from either the dropdown selection or the prefill payload
    const clientName    = isLeadDriven ? prefill!.client_name           : client!.name
    const clientId_     = isLeadDriven ? ""                             : client!.id
    const clientDni     = isLeadDriven ? ""                             : client!.dni
    const clientEmail   = isLeadDriven ? (prefill!.client_email ?? "")   : (client!.emails?.[0] ?? "")
    const clientPhone   = isLeadDriven ? (prefill!.client_phone ?? "")   : (client!.phones?.[0] ?? "")
    const clientAddr    = isLeadDriven ? (prefill!.client_address ?? "") : (client!.addresses?.[0] ?? "")

    const body: Partial<Quote> & Record<string, any> = {
      client_id: clientId_,
      client_name: clientName,
      client_dni: clientDni,
      client_email: clientEmail,
      client_phone: clientPhone,
      client_address: clientAddr,
      internal_notes: internalNotes,
      seller_name: seller,
      seller_phone,
      created_at: new Date().toISOString(),
      quote_number: `A${Math.floor(Math.random() * 9000 + 1000)}`,
      title: title || clientName,
      has_iva: hasIva,
      price: total,
      description: items.length === 1 ? items[0].description : `${items[0]?.description ?? ""} + ${items.length - 1} más`,
      items: items.map(it => ({ ...it, total: it.quantity * it.unit_price, image: "", target_item_index: null })),
      status: "DRAFT",
      lead_id: prefill?.lead_id,
    }
    const r = await create.run("quotes", body)
    if (r) {
      onOpenChange(false)
      if (onCreated) await onCreated(r as Quote)
      else refresh()
    }
  }

  const canSubmit = (isLeadDriven || !!client) && items.length > 0 && items.every(i => i.product_id && i.quantity > 0)

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title={isLeadDriven ? "Nueva cotización (desde lead)" : "Nueva Cotización"} description={isLeadDriven ? `Para ${prefill!.client_name}` : "Generar una cotización en borrador"}
      onSubmit={submit} busy={create.busy} error={create.error || (!canSubmit ? "Completá vendedor, cliente e items" : "")}
      submitLabel={canSubmit ? "Crear cotización" : "Completá los campos"}>
      {isLeadDriven ? (
        <div className="rounded-md border border-border bg-muted/40 p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Cliente del lead</div>
            {prefill!.source && <Badge variant="muted" className="text-[10px] gap-1"><Sparkles className="h-2.5 w-2.5 text-amber-500" />{prefill!.source}</Badge>}
          </div>
          <div className="text-sm font-medium">{prefill!.client_name}</div>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {prefill!.client_phone && <div>📞 {prefill!.client_phone}</div>}
            {prefill!.client_email && <div>✉️ {prefill!.client_email}</div>}
            {prefill!.client_address && <div>📍 {prefill!.client_address}</div>}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        {!isLeadDriven && (
          <div>
            <FieldLabel>Cliente</FieldLabel>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">— Elegí —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <FieldLabel>Vendedor</FieldLabel>
          <select value={seller} onChange={(e) => setSeller(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            {sellers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>Título / referencia (opcional)</FieldLabel>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Obra Pilar / Casa Tortugas" />
      </div>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <FieldLabel>Items</FieldLabel>
          <Button type="button" size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5" />Agregar</Button>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md p-3 text-center">Sin items todavía</div>
        ) : (
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <select value={it.product_id} onChange={(e) => pickProduct(idx, e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-transparent px-2 text-xs">
                    <option value="">— Elegí producto —</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
                  </select>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Cantidad</div>
                    <Input type="number" min={0} step="0.1" value={it.quantity} onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })} className="h-8" />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Precio unit.</div>
                    <Input type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => updateItem(idx, { unit_price: Number(e.target.value) || 0 })} className="h-8" />
                  </div>
                  <div className="text-right text-xs tabular pt-2">
                    <span className="text-muted-foreground">Total: </span>{fmtMoney(it.quantity * it.unit_price)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-2 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasIva} onChange={(e) => setHasIva(e.target.checked)} />
          Incluye IVA ({(IVA_RATE * 100).toFixed(0)}%)
        </label>
        <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular">{fmtMoney(subtotal)}</span></div>
          {hasIva && <div className="flex justify-between"><span className="text-muted-foreground">IVA</span><span className="tabular">{fmtMoney(iva)}</span></div>}
          <div className="flex justify-between font-medium pt-1 border-t border-border"><span>Total</span><span className="tabular">{fmtMoney(total)}</span></div>
        </div>
      </div>

      <div>
        <FieldLabel>Notas internas (opcional)</FieldLabel>
        <Input value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
      </div>
    </FormSheet>
  )
}
