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
  // Moneda en que ENTRA el cobro (default: la de la venta). Una venta en USD (pisos) se puede
  // cobrar en pesos al dólar del día: se registra el monto en pesos en su caja y el saldo de la
  // venta (derivado de amount_usd) baja por el equivalente en USD al TC.
  currency?: "USD" | "ARS"
  exchangeRate?: number   // TC usado cuando el cobro entra en pesos (pesos → USD)
}) {
  const amt = Math.round(opts.amount * 100) / 100
  if (amt <= 0) throw new Error("El monto debe ser mayor a 0")
  const saleIsArs = opts.sale.currency === "ARS"
  const payCur = opts.currency ?? (saleIsArs ? "ARS" : "USD")
  const tc = payCur === "ARS" ? Number(opts.exchangeRate) : null
  if (payCur === "ARS" && !(tc && tc > 0)) throw new Error("Definí el tipo de cambio para el cobro en pesos")
  const amountUsd = payCur === "USD" ? amt : Math.round((amt / (tc as number)) * 100) / 100
  if (!opts.finanzasOn) {
    // Sin finanzas (ej. Panamá, USD nativo): el saldo de la venta se lleva en su moneda.
    const inSaleCur = saleIsArs ? (payCur === "ARS" ? amt : Math.round(amt * (tc || 1) * 100) / 100) : amountUsd
    return api.salePayment(opts.sale.id, inSaleCur, opts.method, opts.notes, opts.date)
  }
  if (!opts.cajaId) throw new Error("Elegí la caja donde entra el cobro")
  const date = (opts.date || new Date().toISOString().slice(0, 10)) + "T00:00:00.000Z"
  // El monto en pesos entra en amount_ars; el equivalente en USD consolida el P&L y deriva el saldo.
  const money = payCur === "ARS"
    ? { currency: "ARS", amount_ars: amt, amount_usd: amountUsd, exchange_rate: tc }
    : { currency: "USD", amount_ars: null as number | null, amount_usd: amt, exchange_rate: null as number | null }
  return api.create("cashflow", {
    flow: "Ingreso",
    date,
    caja_id: opts.cajaId,
    caja_name: opts.cajaName ?? "",
    // La categoría sigue al TIPO de venta (panel vs piso), no a la moneda del cobro.
    category: saleIsArs ? "Venta - No Pisos" : "Venta - Pisos",
    subcategory: null,
    counterparty: opts.sale.client_name,
    counterparty_type: "client",
    description: `Cobro - ${opts.sale.title || opts.sale.client_name}`,
    sale_ref: opts.sale.quote_number,
    ...money,
    fixed_variable: null,
    expense_type: null,
    transfer: false,
    needs_review: false,
    review_reason: null,
  })
}
