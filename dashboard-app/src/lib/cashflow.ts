// Tipos de gasto canónicos (dimensión primaria del P&L) y su asociación con categorías.
// Usado por los formularios de movimiento (CashflowForm) y gasto en efectivo (CashQuickForm).

// Descriptores bancarios GENÉRICOS (el banco los usa para muchas contrapartes distintas): NUNCA
// se aprende una cp_rule sobre ellos (mis-atribuiría todo a un proveedor fijo). El backend también
// lo rechaza. Mirror de import/statements.mjs (GENERIC_BANK_DESCRIPTOR) — mantener en sync.
const GENERIC_BANK_DESCRIPTOR = /transf\.?\s*hb|debito transf|d[eé]bito por|cr[eé]dito por|ib proveedores|\bdebin\b|mov(imiento)? entre cuentas|transferencia (inmediata|recibida|enviada|a cuenta)|pago de servicios tarjeta|dep[oó]sito autoservicio|cuenta propia|su pago en pesos/i
export function isGenericBankDescriptor(name?: string | null): boolean {
  return !!name && GENERIC_BANK_DESCRIPTOR.test(name)
}

export const EXPENSE_TYPES = [
  "COGS", "Gastos de Instalaciones y Suministros", "Gastos Administrativos",
  "Gastos de Personal (HR y Mano de Obra)", "Marketing y Ventas",
  "Gastos de Flota/Vehículos", "Depreciación y Amortización",
  "Impuestos y Tasas", "Otros Gastos y Ajustes",
]

// Mapa curado tipo de gasto → categorías asociadas (refleja cómo están clasificados los
// movimientos reales). La subcategoría se filtra después por la categoría elegida.
export const EXPENSE_TYPE_CATEGORIES: Record<string, string[]> = {
  "COGS": ["Producto", "Importaciones"],
  "Gastos de Instalaciones y Suministros": ["Instalaciones", "HR"],
  "Gastos Administrativos": ["Administración", "HR"],
  "Gastos de Personal (HR y Mano de Obra)": ["HR"],
  "Marketing y Ventas": ["Marketing", "Administración"],
  "Gastos de Flota/Vehículos": ["Flota"],
  "Depreciación y Amortización": ["Bienes de Capital"],
  "Impuestos y Tasas": ["Impuestos"],
  "Otros Gastos y Ajustes": ["Otros", "Otros Gastos y Ajustes", "Ajuste"],
}

// Categorías a mostrar para un tipo de gasto, intersectando con las que existen en los datos.
// Si el tipo no tiene asociadas válidas, devuelve todas (nunca deja el desplegable vacío).
export function categoriesForType(type: string, allEgresoCategories: string[]): string[] {
  const assoc = EXPENSE_TYPE_CATEGORIES[type]
  if (!assoc) return allEgresoCategories
  const have = new Set(allEgresoCategories)
  const inData = assoc.filter((c) => have.has(c))
  return inData.length ? inData : allEgresoCategories
}
