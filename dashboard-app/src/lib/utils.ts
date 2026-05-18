import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmtMoney(n: number | null | undefined, opts: { decimals?: number } = {}) {
  if (n == null || isNaN(n)) return "$ 0"
  return "$ " + n.toLocaleString("es-AR", { maximumFractionDigits: opts.decimals ?? 0 })
}

export function fmtPct(n: number | null | undefined, decimals = 1) {
  if (n == null || isNaN(n)) return "—"
  return (n * 100).toFixed(decimals) + "%"
}

export function fmtInt(n: number | null | undefined) {
  if (n == null || isNaN(n)) return "0"
  return Math.round(n).toLocaleString("es-AR")
}
