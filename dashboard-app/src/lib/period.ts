export type PresetId = "month" | "lastMonth" | "quarter" | "last3" | "last6" | "last12" | "ytd" | "lastYear" | "all" | "custom"

export const DEFAULT_PRESET: PresetId = "month"

export type Range = { from: Date; to: Date; label: string }

export const PRESET_LABELS: Record<PresetId, string> = {
  month: "Este mes",
  lastMonth: "Mes pasado",
  quarter: "Este trimestre",
  last3: "Últimos 3 meses",
  last6: "Últimos 6 meses",
  last12: "Últimos 12 meses",
  ytd: "Este año",
  lastYear: "Año pasado",
  all: "Todo",
  custom: "Custom",
}

export function presetRange(id: PresetId, today = new Date()): Range {
  const d = new Date(today); d.setHours(0,0,0,0)
  let from: Date, to: Date
  // Rolling = desde el 1° del mes (N−1) meses atrás hasta hoy.
  const rolling = (n: number): [Date, Date] => [new Date(d.getFullYear(), d.getMonth() - (n - 1), 1), new Date(d)]
  switch (id) {
    case "month":     from = new Date(d.getFullYear(), d.getMonth(), 1);     to = new Date(d.getFullYear(), d.getMonth()+1, 0); break
    case "lastMonth": from = new Date(d.getFullYear(), d.getMonth()-1, 1);   to = new Date(d.getFullYear(), d.getMonth(), 0);   break
    case "quarter":   {
      const q = Math.floor(d.getMonth()/3)
      from = new Date(d.getFullYear(), q*3, 1)
      to = new Date(d.getFullYear(), q*3+3, 0)
      break
    }
    case "last3":     [from, to] = rolling(3);  break
    case "last6":     [from, to] = rolling(6);  break
    case "last12":    [from, to] = rolling(12); break
    case "ytd":       from = new Date(d.getFullYear(), 0, 1);                 to = new Date(d.getFullYear(), 11, 31); break
    case "lastYear":  from = new Date(d.getFullYear()-1, 0, 1);               to = new Date(d.getFullYear()-1, 11, 31); break
    case "all":       from = new Date(2000, 0, 1);                            to = new Date(d); break
    default:          from = new Date(d.getFullYear(), d.getMonth(), 1);     to = new Date(d.getFullYear(), d.getMonth()+1, 0); break
  }
  to.setHours(23, 59, 59, 999)
  return { from, to, label: PRESET_LABELS[id] }
}

export function priorRange(r: Range): Range {
  const days = Math.round((+r.to - +r.from) / 86400000) + 1
  const priorTo = new Date(r.from); priorTo.setDate(priorTo.getDate() - 1); priorTo.setHours(23,59,59,999)
  const priorFrom = new Date(priorTo); priorFrom.setDate(priorFrom.getDate() - days + 1); priorFrom.setHours(0,0,0,0)
  return { from: priorFrom, to: priorTo, label: "anterior" }
}

export function fmtRange(r: Range): string {
  const s = (d: Date) => d.toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
  return `${s(r.from)} → ${s(r.to)}`
}

export function inRange(iso: string, r: Range): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !isNaN(+d) && d >= r.from && d <= r.to
}

// Last N month buckets ending at the to-date, for sparklines
export function lastNMonths(to: Date, n: number): { ym: string; from: Date; to: Date }[] {
  const out: { ym: string; from: Date; to: Date }[] = []
  for (let i = n - 1; i >= 0; i--) {
    const f = new Date(to.getFullYear(), to.getMonth() - i, 1)
    const t = new Date(to.getFullYear(), to.getMonth() - i + 1, 0, 23, 59, 59, 999)
    out.push({ ym: f.toISOString().slice(0,7), from: f, to: t })
  }
  return out
}
