// Registrar un cobro de venta — ÚNICO camino, compartido por el detalle de Ventas y el menú ⋯.
// CON finanzas: crea un movimiento de caja INGRESO linkeado a la venta (sale_ref) → el "cobrado"
//   se DERIVA de ahí (cashflow_paid en lib/sales.ts). Es la única fuente confiable.
// SIN finanzas (ej. Panamá): cobro directo a la venta (financial_position), sin extractos que dupliquen.
// Antes había DOS flujos que no coincidían: el menú ⋯ bumpeaba financial_position.total_paid, que
// el saldo derivado IGNORA cuando ya hay un cobro en el cashflow → footgun de conciliación.
import { api } from "./mutations"
import type { Sale } from "./types"

export async function registrarCobroVenta(opts: {
  sale: Sale
  amount: number
  finanzasOn: boolean
  cajaId?: string
  cajaName?: string
  date?: string
  method?: string
  notes?: string
}) {
  const amt = Math.round(opts.amount * 100) / 100
  if (amt <= 0) throw new Error("El monto debe ser mayor a 0")
  if (!opts.finanzasOn) {
    return api.salePayment(opts.sale.id, amt, opts.method, opts.notes, opts.date)
  }
  if (!opts.cajaId) throw new Error("Elegí la caja donde entra el cobro")
  const date = (opts.date || new Date().toISOString().slice(0, 10)) + "T00:00:00.000Z"
  return api.create("cashflow", {
    flow: "Ingreso",
    date,
    caja_id: opts.cajaId,
    caja_name: opts.cajaName ?? "",
    category: "Venta - Pisos",
    subcategory: null,
    counterparty: opts.sale.client_name,
    counterparty_type: "client",
    description: `Cobro - ${opts.sale.title || opts.sale.client_name}`,
    sale_ref: opts.sale.quote_number,
    currency: "USD",
    amount_ars: null,
    amount_usd: amt,
    exchange_rate: null,
    fixed_variable: null,
    expense_type: null,
    transfer: false,
    needs_review: false,
    review_reason: null,
  })
}
