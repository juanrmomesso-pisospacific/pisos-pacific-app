export type Product = {
  id: string
  name: string
  sku: string
  category: string
  price: number
  cost: number
  currency: string
  active: boolean
  stock: number
  margin: number
  reservedStock: number
  committed?: number          // m² comprometidos en ventas no finalizadas (derivado)
  stockTrack?: boolean        // true para pisos (se trackea stock); false servicios/extras
  drive_folder_id?: string    // carpeta del Drive con las fotos del producto (banco de imágenes)
  drive_cover_id?: string     // imagen de portada (primera foto de la carpeta)
  createdAt: string
  updatedAt: string
}

export type SaleItem = {
  product_id: string
  sku: string
  description: string
  quantity: number
  unit_price: number
  total: number
  cost?: number               // costo bloqueado al confirmar la venta
  zone?: string               // zona/sección del presupuesto (ej. "Planta Baja")
  image?: string
  category?: string
  disc_kind?: "pct" | "amount"  // descuento por ítem: tipo
  disc_value?: number           // descuento por ítem: valor ingresado (% o $)
  discount?: number             // descuento por ítem: monto resuelto en $ (sin IVA)
}

export type FinancialPosition = {
  total_invoiced: number
  total_paid: number
  balance_due: number
}

export type Sale = {
  id: string
  quote_id?: string
  quote_number: string
  title: string
  description: string
  internal_notes?: string
  public_notes?: string
  payment_terms?: string
  client_name: string
  client_dni: string
  client_email: string
  client_phone: string
  client_address: string
  contract_total: number
  items: SaleItem[]
  zoned?: boolean             // presupuesto separado por zonas
  status: "Confirmado" | "Programado" | "En proceso" | "Finalizado" | string
  delivery_status?: "Finalizado" | "Acopiado" | "Agendado" | null   // avance de obra (planilla ventas)
  payment_state?: string                                            // Cobrado | Adelanto | Pendiente
  created_at: string
  has_iva: boolean
  iva_mode?: "none" | "full" | "fixed"   // sin IVA / IVA 21% / monto fijo (parcial)
  iva_amount?: number                     // IVA en $ (resuelto; editable si mode='fixed')
  financial_position: FinancialPosition
  stock_reserved: boolean
  stock_deducted: boolean
  discount_total?: number     // suma de descuentos por ítem (sin IVA)
  // Cobro real conciliado desde el cashflow (ingresos con este venta_nro)
  cashflow_paid?: number
  cashflow_balance_due?: number   // contract_total − cashflow_paid
  // Remito armado en la inspección (m² de piso + terminaciones que agrega el inspector)
  remito_items?: { description: string; quantity: number; unit: string }[]
  remito_confirmed?: boolean   // versión final confirmada por inspección (para el depósito)
  // Margen calculado por el backend (para dashboards)
  venta_neta?: number
  cogs?: number
  margin?: number
  margin_pct?: number | null
  has_sku_detail?: boolean
  // Desglose por categoría para el P&L híbrido (rev = ingreso, cost = costo bloqueado)
  margin_bd?: { piso: { rev: number; cost: number }; servicio: { rev: number; cost: number }; extras: { rev: number; cost: number } }
  // Optional: many sales include seller name (sometimes empty)
  seller_name?: string
  delivery_date?: string           // start of the delivery window (back-compat — same as delivery_date_from)
  delivery_date_to?: string        // optional end of the window for multi-day installs
  delivery_crew?: string
  delivery_notes?: string
  medicion_data?: {
    m2_medidos?: number
    m2_cotizados?: number
    superficie?: string
    observaciones?: string
    extras?: string
    extras_items?: { description: string; quantity: number; sku?: string }[]
    recorded_at?: string
    recorded_by?: string
  }
  payments?: { ts: string; amount: number; method?: string; notes?: string }[]
}

export type Quote = {
  id: string
  client_id: string
  client_name: string
  client_dni?: string
  client_email?: string
  client_phone?: string
  client_address?: string
  internal_notes?: string
  public_notes?: string
  payment_terms?: string
  seller_name: string
  seller_phone: string
  created_at: string
  quote_number: string
  title: string
  has_iva: boolean
  price: number
  description: string
  items: SaleItem[]
  zoned?: boolean             // presupuesto separado por zonas (PDF en modo sections)
  sale_id?: string
  lead_id?: string
  renewed_at?: string
  valid_days?: number
  discount_kind?: "pct" | "amount"
  discount_value?: number              // the entered number (% or $)
  discount_amount?: number             // resolved $ amount actually deducted from subtotal
  internal_discount_reason?: string
  status: "Borrador" | "Enviado" | "Aceptado" | string
}

// ---- Business data imported from PisosPacific_DataApp_v1.xlsx ----
export type Caja = {
  id: string
  name: string
  type: string            // Banco | Wallet | Efectivo
  currency: string        // ARS | USD
  active: boolean
  notes?: string | null
}

export type Supplier = {
  id: string
  name: string
  type: string
  stock_code?: string | null
  category_default?: string | null
  active: boolean
  notes?: string | null
}

export type Category = {
  id: string
  flow: "Ingreso" | "Egreso"
  category: string
  subcategory?: string | null
  active: boolean
  notes?: string | null
}

export type CashflowMovement = {
  id: string
  date: string | null
  flow: "Ingreso" | "Egreso"
  caja_id: string | null
  caja_name?: string | null
  category?: string | null
  subcategory?: string | null
  counterparty?: string | null
  counterparty_type?: "client" | "supplier"
  client_id?: string | null
  supplier_id?: string | null
  description?: string | null
  sale_ref?: string | null
  currency: string
  amount_ars: number | null
  amount_usd: number | null
  exchange_rate?: number | null
  fixed_variable?: string | null
  expense_type?: string | null
  transfer?: boolean          // inter-account movement / FX swap — excluded from P&L
  needs_review: boolean
  review_reason?: string | null
  linked_sale_id?: string | null    // cobro vinculado a una venta (actualiza su saldo)
  linked_amount_usd?: number
}

export type CajaBalance = {
  caja_id: string
  name: string
  type: string
  currency: string
  movements: number
  balance_usd: number
  balance_ars: number
}

export type ContainerItem = {
  product_id: string
  sku: string
  description: string
  quantity: number
  unit_cost_usd?: number   // opcional: precio de invoice (NO costo nacionalizado, que va aparte)
  lot?: string
}

export type ContainerDocument = {
  id: string
  url: string
  filename: string
  kind: "invoice" | "packing" | "other"
  uploaded_at: string
}

export type Container = {
  id: string
  vessel: string
  supplier: string
  status: "in_transit" | "arrived" | "received"
  etd: string
  eta: string
  received_at?: string
  items: ContainerItem[]
  documents?: ContainerDocument[]
  warehouse_id?: string
  notes?: string
}
