import { useMemo, useState } from "react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { SearchPicker } from "@/components/SearchPicker"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Category, Supplier, CashflowMovement } from "@/lib/types"
import { EXPENSE_TYPES, categoriesForType } from "@/lib/cashflow"

type ClientLite = { id: string; name: string }
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
const isUnnamed = (s?: string | null) => !s || /sin nombre/i.test(s)

// Clasifica un movimiento (asigna proveedor/cliente + categoría + tipo) y, opcionalmente,
// APRENDE la regla: la próxima vez que aparezca ese nombre/CUIT se clasifica solo.
export function ClassifyMovementForm({ mov, open, onOpenChange }: { mov: CashflowMovement | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const categories = useApi<Category[]>("/api/categories").data ?? []
  const suppliers = useApi<Supplier[]>("/api/suppliers").data ?? []
  const clients = useApi<ClientLite[]>("/api/clients").data ?? []
  const isEgreso = mov?.flow !== "Ingreso"
  const originalName = mov?.counterparty || ""
  const learnable = !isUnnamed(originalName)

  const [v, setV] = useState({
    counterparty: "", supplier_id: "", client_id: "",
    category: "", subcategory: "", expense_type: "Gastos de Instalaciones y Suministros",
    learn: true,
  })
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
  }
  const patch = (p: Partial<typeof v>) => setV((prev) => ({ ...prev, ...p }))

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

  async function createSupplier(name: string) {
    const r = await createSup.run("suppliers", { name, type: "supplier", active: true, stock_code: null, category_default: null, notes: null })
    if (r) patch({ counterparty: (r as Supplier).name, supplier_id: (r as Supplier).id, client_id: "" })
  }
  async function createClient(name: string) {
    const r = await createSup.run("clients", { name, type: "client", dni: "", emails: [], phones: [], addresses: [], updated_at: new Date().toISOString() })
    if (r) patch({ counterparty: (r as ClientLite).name, client_id: (r as ClientLite).id, supplier_id: "" })
  }

  async function submit() {
    if (!mov || !v.counterparty) return
    await update.run("cashflow", mov.id, {
      counterparty: v.counterparty, counterparty_type: isEgreso ? "supplier" : "client",
      supplier_id: v.supplier_id || null, client_id: v.client_id || null,
      category: v.category || null, subcategory: v.subcategory || null,
      expense_type: isEgreso ? v.expense_type : null,
      needs_review: false, review_reason: null,
    })
    // Aprender la regla: el nombre ORIGINAL (crudo) → la clasificación elegida.
    if (v.learn && learnable) {
      await createRule.run("cp_rules", {
        match: [originalName], cuit: null, counterparty: v.counterparty,
        category: v.category || null, expense_type: isEgreso ? v.expense_type : null,
        personal: false, source: "learned", note: `Aprendida al clasificar "${originalName}"`,
      })
    }
    onOpenChange(false); refresh()
  }

  const cpItems = (isEgreso ? suppliers : clients).map((x: any) => ({ id: x.id, label: x.name }))
  const pickCp = (id: string) => {
    const f: any = (isEgreso ? suppliers : clients).find((x: any) => x.id === id)
    if (f) patch(isEgreso ? { counterparty: f.name, supplier_id: f.id, client_id: "" } : { counterparty: f.name, client_id: f.id, supplier_id: "" })
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Clasificar movimiento" onSubmit={submit} busy={update.busy} error={update.error} submitLabel="Guardar">
      {mov ? (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <div className="font-medium">{mov.description || mov.counterparty || "—"}</div>
          <div className="text-muted-foreground">{mov.flow} · {mov.caja_name} · ${(mov.amount_ars ?? 0).toLocaleString("es-AR")}</div>
        </div>
      ) : null}

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
    </FormSheet>
  )
}
