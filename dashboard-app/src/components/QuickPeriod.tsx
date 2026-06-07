import { usePeriod } from "@/contexts/PeriodContext"
import { PRESET_LABELS, type PresetId } from "@/lib/period"
import { cn } from "@/lib/utils"

// Atajos de período sincronizados al estado GLOBAL (mismo que el top bar).
// Cambiar acá cambia todas las métricas y el top bar a la vez.
const QUICK: { id: PresetId; short: string }[] = [
  { id: "month", short: "Este mes" },
  { id: "last3", short: "3 meses" },
  { id: "last6", short: "6 meses" },
  { id: "last12", short: "12 meses" },
  { id: "ytd", short: "Año" },
  { id: "all", short: "Todo" },
]

export function QuickPeriod() {
  const { presetId, setPreset } = usePeriod()
  return (
    <div className="flex flex-wrap gap-1">
      {QUICK.map(p => (
        <button key={p.id} onClick={() => setPreset(p.id)} title={PRESET_LABELS[p.id]}
          className={cn("h-8 px-3 text-xs rounded-md border transition",
            presetId === p.id ? "bg-foreground text-background border-foreground" : "border-input text-muted-foreground hover:text-foreground")}>
          {p.short}
        </button>
      ))}
    </div>
  )
}
