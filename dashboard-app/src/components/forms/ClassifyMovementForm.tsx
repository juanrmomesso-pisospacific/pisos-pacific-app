import { useMemo, useState } from "react"
import { Trash2 } from "lucide-react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { SearchPicker } from "@/components/SearchPicker"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Category, Supplier, CashflowMovement, Sale } from "@/lib/types"
import { EXPENSE_TYPES, categoriesForType } from "@/lib/cashflow"
import { fmtMoney } from "@/lib/utils"

type ClientLite = { id: string; name: string }
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
const isUnnamed = (s?: string | null) => !s || /sin nombre/i.test(s)

// Clasifica un movimiento (asigna proveedor/cliente + categoría + tipo) y, opcionalmente,
// APRENDE la regla: la próxima vez que aparezca ese nombre/CUIT se clasifica solo.
export function ClassifyMovementForm({ mov, open, onOpenChange }: { mov: CashflowMovement | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const categories = useApi<Category[]>("/api/categories").data ?? []
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const clients = useApi<ClientLite[]>("/api/clients").data ?? []
  const sales = useApi<Sale[]>("/api/sales").data ?? []
  const isEgreso = mov?.flow !== "Ingreso"
  const originalName = mov?.counterparty || ""
  const learnable = !isUnnamed(originalName)

  // Moneda nativa del movimiento + tipo de cambio (para recalcular la otra moneda al editar el monto).
  const cur = (mov?.currency || "ARS").toUpperCase()
  const rate = mov?.exchange_rate || (mov?.amount_ars && mov?.amount_usd ? mov.amount_ars / mov.amount_usd : 1470)

  const [v, setV] = useState({
    counterparty: "", supplier_id: "", client_id: "",
    category: "", subcategory: "", expense_type: "Gastos de Instalaciones y Suministros",
    learn: true,
  })
  const [amount, setAmount] = useState("")   // monto editable, en la moneda nativa del movimiento
  const [saleId, setSaleId] = useState("")   // venta vinculada (cobro), solo ingresos
  const [transfer, setTransfer] = useState(false)  // fuera del P&L (transferencia / no operativo)
  const [outNote, setOutNote] = useState("")       // concepto cuando se marca fuera del P&L
  // re-sync cuando cambia el movimiento abierto
  const [seen, setSeen] = useState<string | null>(null)
  if (mov && mov.id !== seen) {
    setSeen(mov.id)
    setV({
      // Si no tiene nombre, arrancar con el buscador abierto (no pre-rellenar "sin nombre").
      counterparty: isUnnamed(mov.counterparty) ? "" : (mov.counterparty || ""),
      supplier_id: mov.supplier_id || "", client_id: mov.client_id || "",
      category: mov.category || "", subcategory: mov.subcategory || "",
      expense_type: mov.expense_type || "Gastos de Instalaciones y Suministros", learn: true,
    })
    setAmount(String(cur === "USD" ? (mov.amount_usd ?? 0) : (mov.amount_ars ?? 0)))
    setSaleId(mov.linked_sale_id || "")
    setTransfer(!!mov.transfer)
    setOutNote(mov.transfer ? (mov.category || "") : "")
  }
  const patch = (p: Partial<typeof v>) => setV((prev) => ({ ...prev, ...p }))
  const confirm = useConfirm()
  const remove = useAction(api.remove)
  const origAmount = mov ? (cur === "USD" ? (mov.amount_usd ?? 0) : (mov.amount_ars ?? 0)) : 0
  const amountChanged = Number(amount) !== origAmount && amount.trim() !== ""

  const catMap = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const c of categories) {
      if (c.flow !== (isEgreso ? "Egreso" : "Ingreso")) continue
      const set = m.get(c.category) ?? new Set<string>()
      if (c.subcategory) set.add(c.subcategory)
      m.set(c.category, set)
    }
    return m
  }, [categories, isEgreso])
  const allCats = [...catMap.keys()].sort()
  const catNames = isEgreso ? categoriesForType(v.expense_type, allCats) : allCats
  const subs = [...(catMap.get(v.category) ?? new Set())].sort()

  const update = useAction(api.update)
  const createRule = useAction(api.create)
  const createSup = useAction(api.create)
  const link = useAction(api.linkMovementToSale)
  const linkedSale = sales.find((s) => s.id === saleId) || null

  async function createSupplier(name: string) {
    const r = await createSup.run("suppliers", { name, type: "supplier", active: true, stock_code: null, category_default: null, notes: null })
    if (r) patch({ counterparty: (r as Supplier).name, supplier_id: (r as Supplier).id, client_id: "" })
  }
  async function createClient(name: string) {
    const r = await createSup.run("clients", { name, type: "client", dni: "", emails: [], phones: [], addresses: [], updated_at: new Date().toISOString() })
    if (r) patch({ counterparty: (r as ClientLite).name, client_id: (r as ClientLite).id, supplier_id: "" })
  }

  const linkChanged = !isEgreso && saleId !== (mov?.linked_sale_id || "")
  const transferChanged = transfer !== !!mov?.transfer
  const categoryChanged = (v.category !== (mov?.category || "")) || (v.subcategory !== (mov?.subcategory || ""))
  async function submit() {
    if (!mov || (!v.counterparty && !amountChanged && !linkChanged && !transferChanged && !categoryChanged)) return
    // Corregir el monto primero (recalcula la otra moneda con el TC del movimiento).
    if (amountChanged) {
      const n = Math.abs(Number(amount)) || 0
      await update.run("cashflow", mov.id, {
        amount_ars: cur === "USD" ? Math.round(n * rate * 100) / 100 : n,
        amount_usd: cur === "USD" ? n : Math.round((n / rate) * 100) / 100,
      })
    }
    // Fuera del P&L (transferencia entre cuentas o ingreso/gasto no operativo: alquiler, plata ajena al
    // negocio, etc.): no entra al P&L pero cuenta para el saldo de la caja. Limpia el vínculo a
    // venta/clasificación de gasto (no es ni cobro ni gasto). Si es transferencia, marcar ambas patas.
    if (transfer) {
      await update.run("cashflow", mov.id, {
        transfer: true, needs_review: false, review_reason: null,
        sale_ref: null, linked_sale_id: null, counterparty_type: null,
        category: outNote.trim() || "Fuera del P&L", subcategory: null, expense_type: null,
      })
    } else if (transferChanged) {
      // Se desmarcó: vuelve a contar en el P&L.
      await update.run("cashflow", mov.id, { transfer: false })
    } else if (!isEgreso && (saleId || linkChanged)) {
      // Cobro vinculado a una venta: el endpoint clasifica el movimiento Y actualiza el saldo de la
      // venta (registro único, sin duplicar con una carga manual en Ventas).
      await link.run(mov.id, saleId || null)
    } else if (v.counterparty || categoryChanged) {
      // Clasificar: se puede guardar solo la categoría/subcategoría (ej. "Ingreso Otros / Paneles")
      // aunque no haya contraparte. La contraparte se setea únicamente si se eligió una.
      await update.run("cashflow", mov.id, {
        ...(v.counterparty ? { counterparty: v.counterparty, counterparty_type: isEgreso ? "supplier" : "client", supplier_id: v.supplier_id || null, client_id: v.client_id || null } : {}),
        category: v.category || null, subcategory: v.subcategory || null,
        expense_type: isEgreso ? v.expense_type : null,
        needs_review: false, review_reason: null,
      })
      // Aprender la regla: el nombre ORIGINAL (crudo) → la clasificación elegida (incluye subcategoría;
      // sirve para ingresos también, ej. "CRÉDITO POR CREDIN" → Ingreso Otros / Paneles).
      if (v.learn && learnable) {
        await createRule.run("cp_rules", {
          match: [originalName], cuit: null, counterparty: v.counterparty || null,
          category: v.category || null, subcategory: v.subcategory || null, expense_type: isEgreso ? v.expense_type : null,
          personal: false, source: "learned", note: `Aprendida al clasificar "${originalName}"`,
        })
      }
    }
    onOpenChange(false); refresh()
  }

  async function handleDelete() {
    if (!mov) return
    const ok = await confirm({
      title: "Eliminar movimiento",
      description: `Se va a eliminar "${mov.description || mov.counterparty || "este movimiento"}" (${mov.flow} · $${(mov.amount_ars ?? 0).toLocaleString("es-AR")}). Afecta el saldo de la caja. Esta acción no se puede deshacer.`,
      confirmLabel: "Eliminar", destructive: true,
    })
    if (!ok) return
    const r = await remove.run("cashflow", mov.id)
    if (r !== null) { onOpenChange(false); refresh() }
  }

  const cpItems = (isEgreso ? suppliers : clients).map((x: any) => ({ id: x.id, label: x.name }))
  const pickCp = (id: string) => {
    const f: any = (isEgreso ? suppliers : clients).find((x: any) => x.id === id)
    if (f) patch(isEgreso ? { counterparty: f.name, supplier_id: f.id, client_id: "" } : { counterparty: f.name, client_id: f.id, supplier_id: "" })
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Editar / clasificar movimiento" onSubmit={submit} busy={update.busy || remove.busy || link.busy} error={update.error || remove.error || link.error} submitLabel="Guardar">
      {mov ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <div className="font-medium">{mov.description || mov.counterparty || "—"}</div>
          <div className="text-muted-foreground">{mov.flow} · {mov.caja_name} · {mov.date ? new Date(mov.date).toLocaleDateString("es-AR") : ""}</div>
        </div>
      ) : null}

      <div>
        <FieldLabel>Monto ({cur})</FieldLabel>
        <Input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        {amountChanged && cur === "ARS" && <FieldHint>≈ USD {(Math.abs(Number(amount) || 0) / rate).toLocaleString("es-AR", { maximumFractionDigits: 0 })} (TC {Math.round(rate)})</FieldHint>}
        {amountChanged && cur === "USD" && <FieldHint>≈ ARS {(Math.abs(Number(amount) || 0) * rate).toLocaleString("es-AR", { maximumFractionDigits: 0 })} (TC {Math.round(rate)})</FieldHint>}
      </div>

      {/* Fuera del P&L: transferencia entre cuentas o ingreso/gasto no operativo (alquiler, plata ajena
          al negocio, etc.). Sale del P&L pero cuenta para el saldo de la caja. */}
      <div className="rounded-md border border-border p-2 space-y-1.5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={transfer} onChange={(e) => setTransfer(e.target.checked)} />
          <span>
            <b>Fuera del P&amp;L (transferencia o {isEgreso ? "gasto" : "ingreso"} no operativo)</b>
            <FieldHint>No es {isEgreso ? "un gasto del negocio" : "una venta"}: sale del P&amp;L pero sigue contando para el saldo de la caja. Para transferencias entre cuentas, marcá también la otra pata (ej. el egreso en BBVA).</FieldHint>
          </span>
        </label>
        {transfer && (
          <div>
            <FieldLabel>Concepto</FieldLabel>
            <Input value={outNote} onChange={(e) => setOutNote(e.target.value)} placeholder={isEgreso ? "Ej. Transferencia entre cuentas" : "Ej. Alquiler, transferencia entre cuentas…"} />
          </div>
        )}
      </div>

      {/* Ingreso: ¿es el cobro de una venta? Asociarla actualiza su saldo (registro único, sin duplicar). */}
      {!isEgreso && !transfer && (
        <div className="rounded-md border border-border p-2 space-y-1.5">
          <FieldLabel>¿Es el cobro de una venta?</FieldLabel>
          {linkedSale ? (
            <div className="flex items-center justify-between border border-emerald-500/30 bg-emerald-500/10 rounded-md px-3 h-9 text-sm">
              <span className="truncate">{linkedSale.client_name} · #{linkedSale.quote_number}</span>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => setSaleId("")}>quitar</button>
            </div>
          ) : (
            <SearchPicker
              items={sales.map((s) => ({ id: s.id, label: s.client_name || s.title || s.id, sub: `#${s.quote_number} · saldo ${fmtMoney(s.financial_position?.balance_due ?? 0)}`, keywords: `${s.client_name || ""} ${s.quote_number || ""} ${s.title || ""}` }))}
              placeholder="Buscar venta por cliente o número…"
              onPick={setSaleId}
            />
          )}
          {linkedSale && <FieldHint>Saldo actual {fmtMoney(linkedSale.financial_position?.balance_due ?? 0)} — al asociar se descuenta este cobro (≈ US${Math.round(mov?.amount_usd ?? 0)}).</FieldHint>}
        </div>
      )}

      {!transfer && !(!isEgreso && saleId) && (<>
      <div>
        <FieldLabel>{isEgreso ? "Proveedor" : "Cliente"}</FieldLabel>
        {v.counterparty ? (
          <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
            <span className="truncate">{v.counterparty}</span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => patch({ counterparty: "", supplier_id: "", client_id: "" })}>cambiar</button>
          </div>
        ) : (
          <SearchPicker
            items={cpItems}
            placeholder={isEgreso ? "Buscar proveedor…" : "Buscar cliente…"}
            onPick={pickCp}
            onCreate={isEgreso ? createSupplier : createClient}
            createLabel={(t) => isEgreso ? `+ Crear proveedor "${t}"` : `+ Crear cliente "${t}"`}
          />
        )}
      </div>

      {isEgreso ? (
        <div>
          <FieldLabel>Tipo de gasto (P&amp;L)</FieldLabel>
          <select value={v.expense_type} onChange={(e) => patch({ expense_type: e.target.value, category: "", subcategory: "" })} className={inputSel}>
            {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Categoría</FieldLabel>
          <select value={v.category} onChange={(e) => patch({ category: e.target.value, subcategory: "" })} className={inputSel}>
            <option value="">— Seleccionar —</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel>Subcategoría</FieldLabel>
          <select value={v.subcategory} onChange={(e) => patch({ subcategory: e.target.value })} className={inputSel} disabled={!v.category}>
            <option value="">—</option>
            {subs.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {learnable ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.learn} onChange={(e) => patch({ learn: e.target.checked })} />
          Recordar esta regla: la próxima vez que aparezca <b>“{originalName}”</b> se clasifica solo
        </label>
      ) : (
        <FieldHint>Este movimiento no tiene nombre de contraparte, así que no se puede aprender una regla (solo se clasifica este).</FieldHint>
      )}
      </>)}

      <div className="pt-2 border-t border-border">
        <Button type="button" variant="ghost" className="w-full text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleDelete} disabled={remove.busy}>
          <Trash2 className="h-4 w-4 mr-1" />Eliminar movimiento
        </Button>
      </div>
    </FormSheet>
  )
}
