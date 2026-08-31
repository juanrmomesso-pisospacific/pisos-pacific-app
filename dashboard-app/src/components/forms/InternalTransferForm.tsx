import { useEffect, useMemo, useState } from "react"
import { FormSheet, FieldLabel, FieldHint } from "./FormSheet"
import { Input } from "@/components/ui/input"
import { api, useAction, refresh } from "@/lib/mutations"
import type { Caja } from "@/lib/types"

type Fx = { compra: number; venta: number; promedio: number }
const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
const fmt = (n: number) => (isFinite(n) ? Math.round(n).toLocaleString("es-AR") : "—")

// Movimiento interno entre cajas: arma las dos patas (egreso origen + ingreso destino) en una
// sola operación. Sirve para transferencias de misma moneda (banco→banco) y para cambio de
// moneda (vender/comprar dólares del efectivo). El backend garantiza que el valor USD de las
// dos patas sea igual (el consolidado netea 0) y que el peso quede en amount_ars (concilia sin FX).
export function InternalTransferForm({ open, onOpenChange, cajas }: { open: boolean; onOpenChange: (o: boolean) => void; cajas: Caja[] }) {
  const [fx, setFx] = useState<Fx | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch("https://dolarapi.com/v1/dolares/blue")
        const j = await r.json()
        const compra = Number(j.compra), venta = Number(j.venta)
        if (!cancelled) setFx({ compra, venta, promedio: Math.round((compra + venta) / 2 * 100) / 100 })
      } catch {
        try { const r = await fetch("/api/fx/blue", { credentials: "include" }); if (!cancelled) setFx(await r.json()) } catch { /* manual */ }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const [v, setV] = useState({ from: "", to: "", amountFrom: 0, amountTo: 0, date: today, note: "" })
  const [toTouched, setToTouched] = useState(false)
  const patch = (p: Partial<typeof v>) => setV((prev) => ({ ...prev, ...p }))

  const fromCaja = cajas.find((c) => c.id === v.from)
  const toCaja = cajas.find((c) => c.id === v.to)
  const fromCur = fromCaja?.currency ?? "ARS"
  const toCur = toCaja?.currency ?? "ARS"
  const sameCur = fromCur === toCur
  const blue = fx?.promedio ?? 1425

  // Sugerir el monto que ENTRA (cambio de moneda) al blue, salvo que el usuario lo edite.
  const suggestedTo = useMemo(() => {
    if (sameCur) return v.amountFrom
    if (fromCur === "USD" && toCur === "ARS") return Math.round(v.amountFrom * blue)
    if (fromCur === "ARS" && toCur === "USD") return Math.round((v.amountFrom / blue) * 100) / 100
    return v.amountFrom
  }, [sameCur, fromCur, toCur, v.amountFrom, blue])

  useEffect(() => { if (!toTouched) setV((p) => ({ ...p, amountTo: suggestedTo })) }, [suggestedTo, toTouched])

  const amountTo = sameCur ? v.amountFrom : v.amountTo
  const impliedRate = !sameCur && v.amountFrom && amountTo
    ? (fromCur === "USD" ? amountTo / v.amountFrom : v.amountFrom / amountTo) : 0

  const submit = useAction(api.internalTransfer)
  const canSubmit = !!fromCaja && !!toCaja && v.from !== v.to && v.amountFrom > 0 && (sameCur || amountTo > 0)

  async function onSubmit() {
    if (!canSubmit) return
    const r = await submit.run({
      from_caja_id: v.from, to_caja_id: v.to,
      amount_from: v.amountFrom, amount_to: sameCur ? undefined : amountTo,
      date: v.date, note: v.note.trim() || undefined,
    })
    if (r) {
      onOpenChange(false); refresh()
      setV({ from: "", to: "", amountFrom: 0, amountTo: 0, date: today, note: "" }); setToTouched(false)
    }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Movimiento interno entre cajas" onSubmit={onSubmit} busy={submit.busy} error={submit.error} submitLabel="Registrar transferencia">
      <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Mueve plata de una caja a otra (banco→banco, o cambio de dólares↔pesos del efectivo). Registra <b>las dos patas</b> juntas y queda <b>fuera del P&amp;L</b>. Cada caja se concilia en su propia moneda.
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div>
          <FieldLabel>Desde</FieldLabel>
          <select value={v.from} onChange={(e) => patch({ from: e.target.value })} className={inputSel}>
            <option value="">— Origen —</option>
            {cajas.filter((c) => c.id !== v.to).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
          </select>
        </div>
        <div className="pb-2 text-muted-foreground text-lg">→</div>
        <div>
          <FieldLabel>Hacia</FieldLabel>
          <select value={v.to} onChange={(e) => patch({ to: e.target.value })} className={inputSel}>
            <option value="">— Destino —</option>
            {cajas.filter((c) => c.id !== v.from).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
          </select>
        </div>
      </div>

      <div className={sameCur ? "" : "grid grid-cols-2 gap-3"}>
        <div>
          <FieldLabel>Monto que sale{fromCaja ? ` (${fromCur})` : ""}</FieldLabel>
          <Input type="number" min={0} step="0.01" value={v.amountFrom || ""} onChange={(e) => patch({ amountFrom: Number(e.target.value) })} placeholder="0" />
        </div>
        {!sameCur && (
          <div>
            <FieldLabel>Monto que entra{toCaja ? ` (${toCur})` : ""}</FieldLabel>
            <Input type="number" min={0} step="0.01" value={v.amountTo || ""} onChange={(e) => { setToTouched(true); patch({ amountTo: Number(e.target.value) }) }} placeholder="0" />
          </div>
        )}
      </div>

      {!sameCur && (
        <FieldHint>
          Cambio de moneda: el monto que entra se sugiere al Blue{fx ? ` prom. $${fx.promedio}` : ""} (editable con el valor real que te dieron).
          {impliedRate ? ` · TC implícito ≈ $${fmt(impliedRate)}` : ""}
        </FieldHint>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Fecha</FieldLabel>
          <Input type="date" value={v.date} onChange={(e) => patch({ date: e.target.value })} />
        </div>
        <div>
          <FieldLabel>Nota (opcional)</FieldLabel>
          <Input value={v.note} onChange={(e) => patch({ note: e.target.value })} placeholder="Ej. reponer pesos / giro" />
        </div>
      </div>

      {canSubmit && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Se van a crear dos movimientos</div>
          <div>➖ Sale <b>{fromCur} {fmt(v.amountFrom)}</b> de {fromCaja?.name}</div>
          <div>➕ Entra <b>{toCur} {fmt(amountTo)}</b> a {toCaja?.name}</div>
          <div className="text-[11px] text-muted-foreground">Fuera del P&amp;L · se pueden deshacer juntas desde el Libro.</div>
        </div>
      )}
    </FormSheet>
  )
}
