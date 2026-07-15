import { useState } from "react"
import { errorMessage, triggerGlobalRefresh } from "./api"

async function post<T = any>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json()
}
async function patch<T = any>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json()
}
async function get<T = any>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" })
  if (!r.ok) throw new Error(await errorMessage(r))
  return r.json()
}
async function del(url: string): Promise<boolean> {
  const r = await fetch(url, { method: "DELETE", credentials: "include" })
  if (!r.ok) throw new Error(await errorMessage(r))
  return true
}

export function useAction<TArgs extends any[], TResult>(fn: (...args: TArgs) => Promise<TResult>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (...args: TArgs): Promise<TResult | null> => {
    setBusy(true); setError(null)
    try { return await fn(...args) } catch (e: any) { setError(e?.message ?? String(e)); return null } finally { setBusy(false) }
  }
  return { run, busy, error }
}

export const api = {
  // Quote actions
  quoteTransition: (id: string, status: string) => post(`/api/quotes/${id}/transition`, { status }),
  quoteConvert:    (id: string) => post(`/api/quotes/${id}/convert`),
  quoteDuplicate:  (id: string) => post(`/api/quotes/${id}/duplicate`),
  quoteShare:      (id: string, opts: { whatsapp?: boolean; email?: boolean; message?: string }) => post(`/api/quotes/${id}/share`, opts),
  // Sale actions
  saleTransition:  (id: string, status: string) => post(`/api/sales/${id}/transition`, { status }),
  // Cobro directo sobre la venta (financial_position) — camino de las operaciones SIN módulo
  // finanzas (no crea movimiento de caja; con finanzas el cobro se linkea desde el Libro).
  salePayment:     (id: string, amount: number, method?: string, notes?: string, date?: string) =>
    post(`/api/sales/${id}/payment`, { amount, method, notes, date }),
  // Container actions
  containerReceive: (id: string) => post(`/api/containers/${id}/receive`),
  containerCreate:  (body: any) => post(`/api/containers`, body),
  containerAddDocument:    (id: string, body: { data_base64: string; filename: string; content_type: string; kind?: string }) => post(`/api/containers/${id}/documents`, body),
  containerRemoveDocument: (id: string, docId: string) => del(`/api/containers/${id}/documents/${docId}`),
  productAliasSave:        (description: string, product_id: string) => post(`/api/product-aliases`, { description, product_id }),
  // MercadoPago — T6.A
  paymentLinkCreate:   (saleId: string, amount?: number) => post(`/api/sales/${saleId}/payment-link`, amount != null ? { amount } : undefined),
  paymentLinkSimulate: (linkId: string) => post(`/api/payment-links/${linkId}/simulate-paid`),
  // Importar extractos (MP / BBVA / Banco de Comercio)
  importParse:  (source: string, data_base64: string) => post(`/api/import/parse`, { source, data_base64 }),
  importMpStart:  (days: number) => post(`/api/import/mp-sync/start`, { days }),
  importMpResult: (jobId: number | string) => post(`/api/import/mp-sync/result`, { jobId }),
  importCommit: (movements: any[]) => post(`/api/import/commit`, { movements }),
  importLast:   () => get(`/api/import/last`),
  linkMovementToSale:  (movId: string, sale_id: string | null) => post(`/api/cashflow/${movId}/link-sale`, { sale_id }),
  cashflowBulkUpdate:  (ids: string[], set: Record<string, unknown>) => post(`/api/cashflow/bulk-update`, { ids, set }),
  cajaReconcile:       (id: string, body: { real: number; currency: string; note?: string; commit?: boolean }) => post(`/api/cajas/${id}/reconcile`, body),
  cajasReconciliations: () => get(`/api/cajas/reconciliations`),
  suppliersReview:     () => get(`/api/suppliers/review`),
  supplierRegisterLink: (body: { name?: string; supplier_id?: string; learn?: boolean; commit?: boolean }) => post(`/api/suppliers/register-link`, body),
  supplierMerge:       (body: { from_id: string; to_id: string; commit?: boolean }) => post(`/api/suppliers/merge`, body),
  // Generic CRUD
  create: (entity: string, body: any) => post(`/api/${entity}`, body),
  update: (entity: string, id: string, body: any) => patch(`/api/${entity}/${id}`, body),
  saleEditItems: (id: string, items: any[]) => patch(`/api/sales/${id}/edit-items`, { items }),
  deliverMaterial: (id: string, body: { items?: { sku: string; quantity: number }[]; date?: string; note?: string }) => post(`/api/sales/${id}/deliver-material`, body),
  undoMaterialDelivery: (id: string, delivery_id?: string) => post(`/api/sales/${id}/undo-material-delivery`, delivery_id ? { delivery_id } : undefined),
  remove: (entity: string, id: string) => del(`/api/${entity}/${id}`),
}

/** Reload the page after a successful mutation so all useApi() hooks refetch. Crude but reliable. */
// Refresh suave: re-pide los datos a todos los useApi (sin recargar la página → sin flash ni
// pérdida de scroll/estado). Antes hacía window.location.reload().
export function refresh() { triggerGlobalRefresh() }
