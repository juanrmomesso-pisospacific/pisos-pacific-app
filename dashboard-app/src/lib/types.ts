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
  image?: string
  category?: string
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
  client_name: string
  client_dni: string
  client_email: string
  client_phone: string
  client_address: string
  contract_total: number
  items: SaleItem[]
  status: "Confirmado" | "Programado" | "En proceso" | "Finalizado" | string
  created_at: string
  has_iva: boolean
  financial_position: FinancialPosition
  stock_reserved: boolean
  stock_deducted: boolean
  // Optional: many sales include seller name (sometimes empty)
  seller_name?: string
  delivery_date?: string
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
  seller_name: string
  seller_phone: string
  created_at: string
  quote_number: string
  title: string
  has_iva: boolean
  price: number
  description: string
  items: SaleItem[]
  sale_id?: string
  lead_id?: string
  status: "Borrador" | "Enviado" | "Aceptado" | string
}

export type ContainerItem = {
  product_id: string
  sku: string
  description: string
  quantity: number
  unit_cost_usd: number
  lot?: string
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
  notes?: string
}
