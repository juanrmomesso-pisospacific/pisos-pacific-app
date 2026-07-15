// Config de la operación (producto multi-país/multi-operación): país (impuesto/moneda/locale),
// empresa (marca) y módulos (qué partes de la app usa esta instancia). Viene de GET /api/config
// (subset seguro de settings, sin credenciales). Defaults = Argentina con todo activo, así la
// app se ve igual que siempre mientras carga (y en la instancia AR, siempre).
import { createContext, useContext, useEffect } from "react"
import { useApi } from "@/lib/api"
import { setAppLocale } from "@/lib/utils"

export type AppConfig = {
  company: { name: string; web: string; email: string; warranty?: string; fx_note?: string }
  tax: { rate: number; label: string }
  currency: { local: string; fx_provider: string }
  locale: string
  modules: Record<string, boolean>
}

export const DEFAULT_CONFIG: AppConfig = {
  company: { name: "Pisos Pacific", web: "pisospacific.com", email: "info@pisospacific.com" },
  tax: { rate: 0.21, label: "IVA 21%" },
  currency: { local: "ARS", fx_provider: "blue" },
  locale: "es-AR",
  modules: { finanzas: true, contenedores: true, agenda: true, galeria: true, reportes: true, dashboard_finanzas: true },
}

const Ctx = createContext<AppConfig>(DEFAULT_CONFIG)

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const cfg = useApi<AppConfig>("/api/config").data
  useEffect(() => { if (cfg?.locale) setAppLocale(cfg.locale) }, [cfg?.locale])
  return <Ctx.Provider value={cfg ?? DEFAULT_CONFIG}>{children}</Ctx.Provider>
}

export const useConfig = () => useContext(Ctx)
/** Flags de módulos de la operación (finanzas, agenda, galeria, reportes, contenedores…). */
export function useModules() {
  return useConfig().modules
}
/** ¿La operación usa este módulo? (default: sí — solo un false explícito lo apaga) */
export function moduleOn(modules: Record<string, boolean> | undefined, name: string) {
  return modules?.[name] !== false
}
/** Nombre corto del impuesto: primera palabra de la etiqueta ("IVA 21%" → "IVA", "ITBMS 7%" → "ITBMS"). */
export function taxWord(label: string | undefined) {
  return (label || "").trim().split(/\s+/)[0] || "Impuesto"
}
