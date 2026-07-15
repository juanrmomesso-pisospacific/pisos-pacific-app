import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Locale de la operación (multi-país): default AR; el ConfigProvider lo actualiza al cargar
// /api/config. Módulo-level para que los formateadores sigan siendo funciones puras de uso.
let APP_LOCALE = "es-AR"
export function setAppLocale(locale: string) {
  if (locale) APP_LOCALE = locale
}
export function appLocale() {
  return APP_LOCALE
}

export function fmtMoney(n: number | null | undefined, opts: { decimals?: number } = {}) {
  if (n == null || isNaN(n)) return "$ 0"
  return "$ " + n.toLocaleString(APP_LOCALE, { maximumFractionDigits: opts.decimals ?? 0 })
}

export function fmtPct(n: number | null | undefined, decimals = 1) {
  if (n == null || isNaN(n)) return "—"
  return (n * 100).toFixed(decimals) + "%"
}

export function fmtInt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "0"
  return Math.round(n).toLocaleString(APP_LOCALE)
}
