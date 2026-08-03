// Saldos de ventas — ÚNICA definición para toda la app (Dashboard, Ventas, Reportes,
// CashProjection). Regla: el saldo SIEMPRE se DERIVA (total − cobrado) — nunca se lee el
// balance_due guardado, que puede quedar viejo o roto (migración con signo invertido,
// ediciones de IVA previas al fix del 3/8, etc.). Una venta CANCELADA no debe plata.
import type { Sale } from "./types"

/** Cobrado real: derivado del cashflow si hay cobros linkeados; si no, lo registrado en la venta. */
export function cobradoDe(s: Sale): number {
  return s.cashflow_paid ?? s.financial_position?.total_paid ?? 0
}

/** Saldo a cobrar (puede ser negativo = cobrado de más; 0 para canceladas). */
export function saldoDe(s: Sale): number {
  if (s.status === "Cancelado") return 0
  return Math.round(((Number(s.contract_total) || 0) - cobradoDe(s)) * 100) / 100
}

/** ¿Tiene saldo pendiente de cobro? */
export function tieneSaldo(s: Sale): boolean {
  return saldoDe(s) > 0.5
}
