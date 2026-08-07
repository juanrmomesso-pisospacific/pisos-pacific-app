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

/** Fracción cobrada del total (0..1+). */
export function cobradoPct(s: Sale): number {
  const total = Number(s.contract_total) || 0
  return total ? cobradoDe(s) / total : 0
}

// Relevancia de un saldo pendiente (regla del dueño, 6/8): la antigüedad de la venta NO mide
// mora — hay obras que pagan el anticipo y se colocan a +90 días, y eso está bien. Lo que
// importa es el estado de la obra vs. lo cobrado (término estándar: Anticipo 80% · Conforme 20%):
//   entregada  → Finalizada con saldo: obra entregada sin cobrar (lo más urgente).
//   anticipo   → sin finalizar y cobrado < anticipoPct: confirmamos (y reservamos stock) sin
//                tener el anticipo completo.
//   esperando  → sin finalizar con el anticipo pagado: solo falta el conforme — NO es mora.
export type CobranzaNivel = "entregada" | "anticipo" | "esperando"

export function cobranzaNivel(s: Sale, anticipoPct = 0.8): CobranzaNivel | null {
  if (!tieneSaldo(s)) return null
  if (s.status === "Finalizado") return "entregada"
  return cobradoPct(s) < anticipoPct ? "anticipo" : "esperando"
}

/** Fecha en que la obra se finalizó (para el aging de "entregada sin cobrar").
 *  status_log existe desde jul-2026; para las viejas cae a la fecha de colocación. */
export function finalizadaEl(s: Sale): string | null {
  const log = s.status_log?.filter(e => e.to === "Finalizado")
  if (log?.length) return (log[log.length - 1].at || "").slice(0, 10) || null
  return (s.delivery_date_to || s.delivery_date || "").slice(0, 10) || null
}
