import { useState } from "react"
import { MoreHorizontal, Check, DollarSign, Send, ThumbsUp, X, FileSignature, Truck, Loader, CheckCheck, FileText, Receipt, Link as LinkIcon, Copy, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { downloadBusinessDoc } from "@/lib/pdf"
import { fmtMoney } from "@/lib/utils"
import type { Quote, Sale } from "@/lib/types"

// ---------- Quote row actions ----------
export function QuoteRowActions({ quote }: { quote: Quote }) {
  const txn = useAction(api.quoteTransition)
  const conv = useAction(api.quoteConvert)
  const isDraft = quote.status === "DRAFT" || quote.status === "Borrador"
  const isSent = quote.status === "SENT" || quote.status === "Enviado"
  const isAccepted = quote.status === "ACCEPTED" || quote.status === "Aceptado"
  const convertable = (isAccepted || isSent) && !quote.sale_id

  const handle = async (next: string) => { const r = await txn.run(quote.id, next); if (r) refresh() }
  const handleConvert = async () => { const r = await conv.run(quote.id); if (r) refresh() }
  const handlePdf = () => {
    downloadBusinessDoc({
      kind: "Cotización",
      number: quote.quote_number,
      date: quote.created_at,
      client: { name: quote.client_name, dni: quote.client_dni, address: quote.client_address, email: quote.client_email, phone: quote.client_phone },
      seller: quote.seller_name,
      items: quote.items?.map(it => ({ sku: it.sku, description: it.description, quantity: it.quantity, unit_price: it.unit_price })) ?? [],
      hasIva: !!quote.has_iva,
      notes: quote.internal_notes,
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Cotización #{quote.quote_number}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isDraft && <DropdownMenuItem onClick={() => handle("Enviado")}><Send className="h-3.5 w-3.5 mr-2" />Marcar enviada</DropdownMenuItem>}
        {isSent && <DropdownMenuItem onClick={() => handle("Aceptado")}><ThumbsUp className="h-3.5 w-3.5 mr-2" />Marcar aceptada</DropdownMenuItem>}
        {convertable && <DropdownMenuItem onClick={handleConvert}><FileSignature className="h-3.5 w-3.5 mr-2" />Convertir a venta</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handlePdf}><FileText className="h-3.5 w-3.5 mr-2" />Generar PDF</DropdownMenuItem>
        <DropdownMenuSeparator />
        {!isDraft && <DropdownMenuItem onClick={() => handle("Borrador")}>Volver a borrador</DropdownMenuItem>}
        <DropdownMenuItem className="text-destructive" onClick={() => handle("Rechazado")}><X className="h-3.5 w-3.5 mr-2" />Rechazar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------- Sale row actions ----------
export function SaleRowActions({ sale }: { sale: Sale }) {
  const txn = useAction(api.saleTransition)
  const [payOpen, setPayOpen] = useState(false)
  const [gastosOpen, setGastosOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const due = sale.financial_position?.balance_due ?? 0

  const handle = async (next: string) => { const r = await txn.run(sale.id, next); if (r) refresh() }
  const handlePdf = () => {
    downloadBusinessDoc({
      kind: "Venta",
      number: sale.quote_number,
      date: sale.created_at,
      client: { name: sale.client_name, dni: sale.client_dni, address: sale.client_address, email: sale.client_email, phone: sale.client_phone },
      seller: sale.seller_name,
      items: sale.items?.map(it => ({ sku: it.sku, description: it.description, quantity: it.quantity, unit_price: it.unit_price })) ?? [],
      hasIva: !!sale.has_iva,
      notes: sale.internal_notes,
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Venta #{sale.quote_number}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => handle("Programado")}><Truck className="h-3.5 w-3.5 mr-2" />Marcar programada</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("En proceso")}><Loader className="h-3.5 w-3.5 mr-2" />En proceso</DropdownMenuItem>
          <DropdownMenuItem onClick={() => handle("Finalizado")}><CheckCheck className="h-3.5 w-3.5 mr-2" />Finalizar (descontar stock)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handlePdf}><FileText className="h-3.5 w-3.5 mr-2" />Generar PDF</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setGastosOpen(true)}><Receipt className="h-3.5 w-3.5 mr-2" />Gastos asociados</DropdownMenuItem>
          {due > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPayOpen(true)}><DollarSign className="h-3.5 w-3.5 mr-2" />Registrar pago ({fmtMoney(due)})</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLinkOpen(true)}><LinkIcon className="h-3.5 w-3.5 mr-2" />Link de pago MP</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={() => handle("Cancelado")}><X className="h-3.5 w-3.5 mr-2" />Cancelar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PaymentDrawer open={payOpen} onOpenChange={setPayOpen} sale={sale} />
      <LinkedExpensesDrawer open={gastosOpen} onOpenChange={setGastosOpen} sale={sale} />
      <PaymentLinkDrawer open={linkOpen} onOpenChange={setLinkOpen} sale={sale} />
    </>
  )
}

// ---------- T6.A — Payment link drawer ----------
function PaymentLinkDrawer({ open, onOpenChange, sale }: { open: boolean; onOpenChange: (o: boolean) => void; sale: Sale }) {
  const due = sale.financial_position?.balance_due ?? 0
  const [link, setLink] = useState<{ id: string; init_point: string; mode: "mock" | "live"; amount: number } | null>(null)
  const [amount, setAmount] = useState<number>(due)
  const [copied, setCopied] = useState(false)
  const create = useAction(api.paymentLinkCreate)
  const simulate = useAction(api.paymentLinkSimulate)

  const generate = async () => {
    if (amount <= 0) return
    const r = await create.run(sale.id, amount)
    if (r) setLink(r)
  }

  const reset = () => { setLink(null); setCopied(false); setAmount(due) }

  const handleCopy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link.init_point); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* ignore */ }
  }

  const wappMessage = link
    ? encodeURIComponent(`Hola${sale.client_name ? " " + sale.client_name.split(" ")[0] : ""}, te paso el link para abonar la venta ${sale.quote_number} por ${fmtMoney(link.amount)}: ${link.init_point}\n\nCualquier consulta acá estoy. Gracias!`)
    : ""
  const wappHref = sale.client_phone
    ? `https://wa.me/${sale.client_phone.replace(/[^\d]/g, "")}?text=${wappMessage}`
    : `https://wa.me/?text=${wappMessage}`

  const handleSimulate = async () => {
    if (!link) return
    const r = await simulate.run(link.id)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Link de pago MercadoPago</SheetTitle>
          <SheetDescription>#{sale.quote_number} · {sale.client_name}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {!link ? (
            <>
              <div className="rounded-md border border-border p-3 text-sm bg-muted/40">
                <div className="flex justify-between"><span className="text-muted-foreground">Saldo pendiente</span><span className="tabular font-medium">{fmtMoney(due)}</span></div>
              </div>
              <div>
                <label className="text-sm font-medium block mb-1">Monto del link</label>
                <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
                <div className="text-[11px] text-muted-foreground mt-1">Podés generar un link por el total o por un anticipo.</div>
              </div>
              <Button onClick={generate} disabled={create.busy || amount <= 0} className="w-full">
                {create.busy ? "Generando…" : `Generar link por ${fmtMoney(amount)}`}
              </Button>
              {create.error && <div className="text-xs text-destructive">{create.error}</div>}
            </>
          ) : (
            <>
              <div className="rounded-md border border-border p-3 bg-muted/40 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Modo</span>
                  <Badge variant={link.mode === "live" ? "default" : "muted"} className="text-[10px]">
                    {link.mode === "live" ? "Producción" : "Demo"}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Monto</span><span className="tabular font-medium">{fmtMoney(link.amount)}</span></div>
                <div className="text-[10px] text-muted-foreground break-all mt-2 font-mono">{link.init_point}</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" onClick={handleCopy}><Copy className="h-3.5 w-3.5 mr-1.5" />{copied ? "Copiado" : "Copiar"}</Button>
                <Button type="button" variant="outline" asChild>
                  <a href={link.init_point} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5 mr-1.5" />Abrir</a>
                </Button>
              </div>
              <Button asChild className="w-full">
                <a href={wappHref} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
              </Button>
              {link.mode === "mock" && (
                <div className="pt-3 border-t border-border space-y-2">
                  <div className="text-[11px] text-muted-foreground">
                    Modo demo: MercadoPago no está configurado en <code>/configuracion</code>. Podés simular un pago aprobado para probar el flujo.
                  </div>
                  <Button type="button" variant="secondary" className="w-full" onClick={handleSimulate} disabled={simulate.busy}>
                    {simulate.busy ? "Simulando…" : "Simular pago aprobado"}
                  </Button>
                  {simulate.error && <div className="text-xs text-destructive">{simulate.error}</div>}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ---------- Linked expenses drawer ----------
function LinkedExpensesDrawer({ open, onOpenChange, sale }: { open: boolean; onOpenChange: (o: boolean) => void; sale: Sale }) {
  const expenses = useApi<any[]>("/api/expenses").data ?? []
  const linked = expenses.filter(e => e.sale_reference === sale.quote_number)
  const totalExp = linked.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const cogs = (sale.items ?? []).reduce((acc, _it) => acc + 0, 0)  // placeholder — real cogs needs product lookup
  const margin = (sale.contract_total || 0) - totalExp
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Gastos asociados a venta</SheetTitle>
          <SheetDescription>#{sale.quote_number} · {sale.client_name}</SheetDescription>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-border p-3"><div className="text-muted-foreground">Ingresos</div><div className="tabular font-medium mt-1">{fmtMoney(sale.contract_total)}</div></div>
            <div className="rounded-md border border-border p-3"><div className="text-muted-foreground">Gastos atribuidos</div><div className="tabular font-medium mt-1">{fmtMoney(totalExp)}</div></div>
            <div className="rounded-md border border-border p-3"><div className="text-muted-foreground">Margen aprox.</div><div className="tabular font-medium mt-1">{fmtMoney(margin)}</div></div>
          </div>
          {linked.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">Esta venta no tiene gastos atribuidos. Asocialos desde el formulario "Nuevo gasto".</div>
          ) : (
            <ul className="divide-y divide-border border border-border rounded-md">
              {linked.map(e => (
                <li key={e.id} className="px-3 py-2 flex items-start justify-between text-sm gap-2">
                  <div className="min-w-0">
                    <div className="truncate">{e.description}</div>
                    <div className="text-xs text-muted-foreground">{e.date} · {e.category} · {e.subcategory}</div>
                  </div>
                  <div className="tabular shrink-0">{fmtMoney(e.amount)}</div>
                </li>
              ))}
            </ul>
          )}
          {cogs ? null : null /* keep cogs var referenced */}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ---------- Quick action buttons for Pedidos Recientes (compact view) ----------
export function QuickSaleActions({ sale }: { sale: Sale }) {
  const txn = useAction(api.saleTransition)
  const [payOpen, setPayOpen] = useState(false)
  const due = sale.financial_position?.balance_due ?? 0
  const handleFinalize = async () => { const r = await txn.run(sale.id, "Finalizado"); if (r) refresh() }
  return (
    <>
      <div className="inline-flex gap-1">
        {!sale.stock_deducted ? <Button size="icon" variant="ghost" className="h-8 w-8" title="Marcar entregado" onClick={handleFinalize}><Check className="h-3.5 w-3.5" /></Button> : null}
        {due > 0 ? <Button size="icon" variant="ghost" className="h-8 w-8" title={`Cobrar ${fmtMoney(due)}`} onClick={() => setPayOpen(true)}><DollarSign className="h-3.5 w-3.5" /></Button> : null}
      </div>
      <PaymentDrawer open={payOpen} onOpenChange={setPayOpen} sale={sale} />
    </>
  )
}

// ---------- Payment drawer ----------
function PaymentDrawer({ open, onOpenChange, sale }: { open: boolean; onOpenChange: (o: boolean) => void; sale: Sale }) {
  const settings = useApi<{ paymentMethods?: string[] }>("/api/settings").data
  const methods = settings?.paymentMethods ?? []
  const due = sale.financial_position?.balance_due ?? 0
  const [amount, setAmount] = useState<number>(due)
  const [method, setMethod] = useState<string>(methods[0] ?? "")
  const [notes, setNotes] = useState<string>("")
  const pay = useAction(api.salePayment)

  const submit = async () => {
    if (amount <= 0) return
    const r = await pay.run(sale.id, amount, method, notes)
    if (r) { onOpenChange(false); refresh() }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Registrar pago</SheetTitle>
          <SheetDescription>#{sale.quote_number} · {sale.client_name}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="rounded-md border border-border p-3 text-sm bg-muted/40">
            <div className="flex justify-between"><span className="text-muted-foreground">Total contrato</span><span className="tabular">{fmtMoney(sale.contract_total)}</span></div>
            <div className="flex justify-between mt-1"><span className="text-muted-foreground">Ya pagado</span><span className="tabular">{fmtMoney(sale.financial_position?.total_paid)}</span></div>
            <div className="flex justify-between mt-1 font-medium"><span>Saldo</span><span className="tabular">{fmtMoney(due)}</span></div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Monto</label>
            <Input type="number" min={0} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            <div className="mt-2 flex gap-1">
              {[due, due/2, due/4].filter(v => v > 0).map((v, i) => (
                <Button key={i} type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setAmount(Math.round(v))}>{fmtMoney(v)}</Button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Método</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {methods.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Notas (opcional)</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Comprobante, transferencia ID…" />
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={submit} disabled={pay.busy || amount <= 0}>{pay.busy ? "Registrando…" : `Registrar ${fmtMoney(amount)}`}</Button>
            {pay.error && <span className="text-xs text-destructive">{pay.error}</span>}
          </div>
          {(sale.payments && sale.payments.length > 0) && (
            <div className="pt-4 border-t border-border">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Pagos anteriores</div>
              <ul className="space-y-1.5">
                {sale.payments.map((p: any, i: number) => (
                  <li key={i} className="flex items-center justify-between text-xs">
                    <span>{new Date(p.ts).toLocaleDateString("es-AR")}</span>
                    <span className="text-muted-foreground">{p.method}</span>
                    <span className="tabular">{fmtMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Helper component for status badge consistency
export function StatusBadge({ status }: { status: string }) {
  const variant = (status === "Cancelado" || status === "REJECTED") ? "destructive" : "outline"
  const label = status === "DRAFT" ? "Borrador" : status === "SENT" ? "Enviado" : status === "ACCEPTED" ? "Aceptado" : status === "REJECTED" ? "Rechazado" : status
  return <Badge variant={variant as any}>{label}</Badge>
}
