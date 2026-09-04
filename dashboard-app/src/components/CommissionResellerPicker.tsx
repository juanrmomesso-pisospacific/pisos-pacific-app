import { FieldLabel } from "@/components/forms/FormSheet"
import { SearchPicker } from "@/components/SearchPicker"
import { fmtMoney } from "@/lib/utils"
import { computeCommission, type LineLike, type ResellerFields } from "@/lib/reseller"
import type { Product } from "@/lib/types"

type ResellerClient = { id: string; name: string; phones?: string[] } & ResellerFields

// Selector de "Revendedor por comisión" (aparte del cliente). Usado por QuoteForm y SaleForm.
// El cliente paga precio de lista; la comisión se calcula sobre los pisos y se guarda en la venta.
export function CommissionResellerPicker({ clients, items, products, value, onChange, help }: {
  clients: ResellerClient[]
  items: LineLike[]
  products: Product[]
  value: string
  onChange: (id: string) => void
  help?: boolean
}) {
  const reseller = clients.find(c => c.id === value && c.reseller && c.reseller_mode === "comision") || null
  const est = reseller ? computeCommission(reseller.reseller_comision, items, products) : null
  return (
    <div>
      <FieldLabel>Revendedor por comisión (opcional)</FieldLabel>
      {reseller ? (
        <div className="flex items-center justify-between border border-border rounded-md px-3 h-9 text-sm bg-muted/30">
          <span className="truncate">{reseller.name}{est && est.amount > 0 ? <span className="text-muted-foreground"> · comisión ≈ {fmtMoney(est.amount)}</span> : null}</span>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground shrink-0" onClick={() => onChange("")}>quitar</button>
        </div>
      ) : (
        <SearchPicker
          items={clients.filter(c => c.reseller && c.reseller_mode === "comision").map(c => ({ id: c.id, label: c.name, sub: "comisión", keywords: (c.phones || []).join(" ") }))}
          placeholder="Buscar revendedor (trae al cliente)…"
          onPick={onChange}
        />
      )}
      {help && <p className="text-[11px] text-muted-foreground mt-1">El cliente paga precio de lista; la comisión se calcula sobre los pisos y se guarda en la venta.</p>}
    </div>
  )
}
