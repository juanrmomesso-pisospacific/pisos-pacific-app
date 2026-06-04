import { useEffect, useMemo, useState } from "react"
import { Trash2, Sparkles, AlertTriangle } from "lucide-react"
import { FormSheet, FieldLabel } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { fmtMoney } from "@/lib/utils"
import { SearchPicker } from "@/components/SearchPicker"
import type { Product, Quote } from "@/lib/types"

type Settings = { sellers?: { name: string; phone?: string }[] }
type Client = { id: string; name: string; dni: string; phones?: string[]; emails?: string[]; addresses?: string[] }
type LineItem = { product_id: string; sku: string; description: string; quantity: number; unit_price: number; category: string; zone?: string }

export type QuotePrefill = {
  lead_id?: string
  client_name: string
  client_phone?: string
  client_email?: string
  client_address?: string
  title?: string
  internal_notes?: string
  source?: string  // shown as a small "desde {source}" hint
  interested_products?: string[]  // pre-add matching catalog products as items
  approx_m2?: number               // distributed across matched items as initial qty
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
  const [address, setAddress] = useState<string>(prefill?.client_address ?? "")
  const [internalNotes, setInternalNotes] = useState<string>(prefill?.internal_notes ?? "")
  const [hasIva, setHasIva] = useState<boolean>(false)
  const [items, setItems] = useState<LineItem[]>([])
  const [discountKind, setDiscountKind] = useState<"pct" | "amount">("pct")
  const [discountValue, setDiscountValue] = useState<number>(0)
  const [discountReason, setDiscountReason] = useState<string>("")
  const [zoned, setZoned] = useState<boolean>(false)
  const [zones, setZones] = useState<string[]>(["Planta Baja"])

  const [extraClients, setExtraClients] = useState<Client[]>([])
  const allClients = useMemo(() => [...clients, ...extraClients], [clients, extraClients])
  const client = allClients.find(c => c.id === clientId)
  const create = useAction(api.create)
  const createClient = useAction(api.create)
  const isLeadDriven = !!prefill

  function addProduct(productId: string, zone?: string) {
    const p = products.find(x => x.id === productId)
    if (!p) return
    setItems(prev => [...prev, { product_id: p.id, sku: p.sku, description: p.name, quantity: 1, unit_price: p.price, category: p.category, zone }])
  }
  function addZone() { setZones(prev => [...prev, `Zona ${prev.length + 1}`]) }
  function renameZone(idx: number, name: string) {
    setZones(prev => { const old = prev[idx]; const next = prev.map((z, i) => i === idx ? name : z); setItems(its => its.map(it => it.zone === old ? { ...it, zone: name } : it)); return next })
  }
  function removeZone(name: string) {
    setItems(prev => prev.filter(it => it.zone !== name))
    setZones(prev => prev.filter(z => z !== name))
  }
  async function createAndPickClient(name: string) {
    const r = await createClient.run("clients", { name, type: "client", dni: "", emails: [], phones: [], addresses: [], updated_at: new Date().toISOString() })
    if (r) { setExtraClients(prev => [...prev, r as Client]); setClientId((r as Client).id) }
  }

  // Walk-in mode: when the user picks a client, copy its saved address as the default
  // (vendor can still override below). Skip in lead-driven mode (prefill controls address).
  useEffect(() => {
    if (isLeadDriven || !client) return
    setAddress(client.addresses?.[0] ?? "")
  }, [clientId])

  // Lead-driven: when the sheet opens AND we have both prefill interests and product
  // catalog loaded, pre-add matching items so the vendor starts with the relevant SKUs.
  // Skipped if the vendor already added items manually.
  useEffect(() => {
    if (!open || !isLeadDriven || items.length > 0) return
    const interests = prefill!.interested_products ?? []
    if (interests.length === 0 || products.length === 0) return
    const matched: LineItem[] = []
    const used = new Set<string>()
    for (const term of interests) {
      const needle = term.toLowerCase()
      const p = products.find(pr => !used.has(pr.id) && (pr.name.toLowerCase().includes(needle) || pr.sku.toLowerCase().includes(needle) || needle.includes(pr.name.toLowerCase())))
      if (!p) continue
      used.add(p.id)
      matched.push({ product_id: p.id, sku: p.sku, description: p.name, quantity: 0, unit_price: p.price, category: p.category })
    }
    if (matched.length === 0) return
    // If the lead has approx m², split across matched products
    const m2 = prefill!.approx_m2
    if (m2 && matched.length > 0) {
      const each = Math.max(1, Math.round((m2 / matched.length) * 10) / 10)
      for (const m of matched) m.quantity = each
    } else {
      for (const m of matched) m.quantity = 1
    }
    setItems(matched)
  }, [open, products.length])

  const subtotal = useMemo(() => items.reduce((s, i) => s + (i.quantity * i.unit_price), 0), [items])
  const discountAmount = useMemo(() => {
    if (discountValue <= 0) return 0
    if (discountKind === "pct") return Math.min(subtotal, subtotal * discountValue / 100)
    return Math.min(subtotal, discountValue)
  }, [discountKind, discountValue, subtotal])
  const subtotalAfterDiscount = Math.max(0, subtotal - discountAmount)
  const iva = hasIva ? subtotalAfterDiscount * IVA_RATE : 0
  const total = subtotalAfterDiscount + iva

  function updateItem(idx: number, patch: Partial<LineItem>) {
    setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx))
  }

  async function submit() {
    if (items.length === 0) return
    if (!isLeadDriven && !client) return
    const seller_phone = sellers.find(s => s.name === seller)?.phone ?? ""

    // Resolve client info from either the dropdown selection or the prefill payload.
    // Address always comes from the vendor-editable field below (defaults to client's saved address).
    const clientName    = isLeadDriven ? prefill!.client_name           : client!.name
    const clientId_     = isLeadDriven ? ""                             : client!.id
    const clientDni     = isLeadDriven ? ""                             : client!.dni
    const clientEmail   = isLeadDriven ? (prefill!.client_email ?? "")   : (client!.emails?.[0] ?? "")
    const clientPhone   = isLeadDriven ? (prefill!.client_phone ?? "")   : (client!.phones?.[0] ?? "")
    const clientAddr    = address.trim()

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
      zoned: zoned || undefined,
      description: items.length === 1 ? items[0].description : `${items[0]?.description ?? ""} + ${items.length - 1} más`,
      items: items.map(it => ({ ...it, total: it.quantity * it.unit_price, image: "", target_item_index: null })),
      status: "DRAFT",
      lead_id: prefill?.lead_id,
      discount_kind: discountAmount > 0 ? discountKind : undefined,
      discount_value: discountAmount > 0 ? discountValue : undefined,
      discount_amount: discountAmount > 0 ? Math.round(discountAmount * 100) / 100 : undefined,
      internal_discount_reason: discountReason || undefined,
    }
    const r = await create.run("quotes", body)
    if (r) {
      onOpenChange(false)
      if (onCreated) await onCreated(r as Quote)
      else refresh()
    }
  }

  const canSubmit = (isLeadDriven || !!client) && items.length > 0 && items.every(i => i.product_id && i.quantity > 0)

  const productPickerItems = products.filter(p => p.active !== false).map(p => {
    const av = (Number(p.stock) || 0) - (Number(p.committed ?? p.reservedStock) || 0)
    return { id: p.id, label: p.name, sub: p.sku, keywords: p.category, hint: fmtMoney(p.price) + (p.stockTrack && av <= 0 ? " · sin stock" : "") }
  })
  const itemCard = (it: LineItem, idx: number) => {
    const p = products.find(x => x.id === it.product_id)
    const stock = Number(p?.stock ?? 0)
    const reserved = Number(p?.committed ?? p?.reservedStock ?? 0)
    const available = stock - reserved
    const isFloor = !!p && !!p.stockTrack
    const oversold = isFloor && it.quantity > available
    const noStock = isFloor && available <= 0
    return (
      <div key={idx} className={`rounded-md border p-3 space-y-2 ${oversold ? "border-amber-500/60 bg-amber-50/40" : "border-border"}`}>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm truncate">{it.description}</div>
            <div className="text-[10px] text-muted-foreground tabular">{it.sku}</div>
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeItem(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        {isFloor && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular -mt-1">
            <span>Stock: <span className="text-foreground">{stock}</span> · comprometido: <span className="text-amber-700">{reserved}</span> · disponible: <span className={available <= 0 ? "text-destructive font-medium" : available <= 5 ? "text-amber-600 font-medium" : "text-foreground"}>{available}</span></span>
            {oversold && (
              <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                <AlertTriangle className="h-3 w-3" />
                {noStock ? "Sin stock disponible" : `Falta ${(it.quantity - available).toFixed(2)} m²`}
              </span>
            )}
          </div>
        )}
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
    )
  }

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
            {client ? (
              <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
                <span className="truncate">{client.name}</span>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => setClientId("")}>cambiar</button>
              </div>
            ) : (
              <SearchPicker
                items={allClients.map(c => ({ id: c.id, label: c.name, sub: c.dni || undefined, keywords: (c.phones || []).join(" ") }))}
                placeholder="Buscar cliente…"
                onPick={setClientId}
                onCreate={createAndPickClient}
                createLabel={(t) => `+ Crear cliente "${t}"`}
              />
            )}
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
      <div>
        <FieldLabel>Dirección / Obra</FieldLabel>
        <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Av. del Libertador 1234 / Casa Pilar" />
        <p className="text-[11px] text-muted-foreground mt-1">Aparece en el PDF como "Dirección" del cliente.</p>
      </div>

      <div className="pt-2">
        <div className="flex items-center justify-between mb-1.5">
          <FieldLabel>Items</FieldLabel>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input type="checkbox" checked={zoned} onChange={(e) => setZoned(e.target.checked)} />
            Separar por zonas
          </label>
        </div>

        {!zoned ? (
          <>
            <SearchPicker items={productPickerItems} placeholder="Buscar producto o servicio para agregar…" onPick={(id) => addProduct(id)} />
            {items.length === 0 ? (
              <div className="text-xs text-muted-foreground italic border border-dashed border-border rounded-md p-3 text-center mt-2">Buscá un producto arriba para agregarlo</div>
            ) : (
              <div className="space-y-2 mt-2">{items.map((it) => itemCard(it, items.indexOf(it)))}</div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            {zones.map((zone, zi) => {
              const zoneItems = items.filter(it => it.zone === zone)
              const zoneSub = zoneItems.reduce((s, it) => s + it.quantity * it.unit_price, 0)
              return (
                <div key={zi} className="rounded-md border border-border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center gap-2">
                    <Input value={zone} onChange={(e) => renameZone(zi, e.target.value)} className="h-8 font-medium" placeholder="Nombre de la zona" />
                    <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeZone(zone)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                  <SearchPicker items={productPickerItems} placeholder={`Agregar a ${zone}…`} onPick={(id) => addProduct(id, zone)} />
                  {zoneItems.length > 0 && <div className="space-y-2">{zoneItems.map((it) => itemCard(it, items.indexOf(it)))}</div>}
                  <div className="flex justify-between text-xs font-medium pt-1 border-t border-border"><span>Subtotal {zone}</span><span className="tabular">{fmtMoney(zoneSub)}</span></div>
                </div>
              )
            })}
            <Button type="button" size="sm" variant="outline" onClick={addZone}>+ Agregar zona</Button>
          </div>
        )}
      </div>

      <div className="pt-2 space-y-2">
        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Descuento</div>
            <div className="inline-flex rounded-md border border-input overflow-hidden">
              <button type="button" onClick={() => setDiscountKind("pct")} className={`px-2 h-7 text-xs ${discountKind === "pct" ? "bg-foreground text-background" : "bg-transparent"}`}>%</button>
              <button type="button" onClick={() => setDiscountKind("amount")} className={`px-2 h-7 text-xs ${discountKind === "amount" ? "bg-foreground text-background" : "bg-transparent"}`}>$</button>
            </div>
          </div>
          <Input type="number" min={0} step="0.01" value={discountValue} onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))} className="h-8" placeholder={discountKind === "pct" ? "0%" : "$ 0"} />
          {discountAmount > 0 && (
            <div className="text-[11px] text-muted-foreground tabular">
              Descontado: <span className="text-foreground font-medium">{fmtMoney(discountAmount)}</span>{discountKind === "pct" ? ` (${discountValue}% sobre ${fmtMoney(subtotal)})` : ""}
            </div>
          )}
          <Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Motivo interno (no aparece en el PDF)" className="h-8 text-xs" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasIva} onChange={(e) => setHasIva(e.target.checked)} />
          Incluye IVA ({(IVA_RATE * 100).toFixed(0)}%)
        </label>
        <div className="bg-muted/50 rounded-md p-3 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular">{fmtMoney(subtotal)}</span></div>
          {discountAmount > 0 && (
            <>
              <div className="flex justify-between text-emerald-700"><span>Descuento{discountKind === "pct" ? ` (-${discountValue}%)` : ""}</span><span className="tabular">−{fmtMoney(discountAmount)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal c/desc.</span><span className="tabular">{fmtMoney(subtotalAfterDiscount)}</span></div>
            </>
          )}
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
