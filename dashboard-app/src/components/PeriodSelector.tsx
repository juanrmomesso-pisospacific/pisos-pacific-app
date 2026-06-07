import { Calendar, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { usePeriod } from "@/contexts/PeriodContext"
import { PRESET_LABELS, fmtRange, type PresetId } from "@/lib/period"
import { cn } from "@/lib/utils"

const ROLLING: PresetId[] = ["month", "lastMonth", "quarter", "last3", "last6", "last12"]
const CALENDAR: PresetId[] = ["ytd", "lastYear", "all"]

export function PeriodSelector() {
  const { presetId, range, setPreset, setCustom, customFrom, customTo, isDefault, reset } = usePeriod()
  const isCustom = presetId === "custom"

  return (
    <div className="inline-flex items-center gap-1">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Custom = filtro "raro" → acento ámbar para que sea imposible no verlo */}
        <Button variant={isCustom ? "outline" : "default"} size="sm" className={cn("gap-2", isCustom && "border-amber-500 text-amber-700 bg-amber-50 hover:bg-amber-100")}>
          <Calendar className="h-3.5 w-3.5" />
          <span>{PRESET_LABELS[presetId]}</span>
          <span className={cn("text-xs ml-1", isCustom ? "text-amber-700/80" : "text-primary-foreground/70")}>· {fmtRange(range)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Período</DropdownMenuLabel>
        {ROLLING.map((id) => (
          <DropdownMenuItem key={id} onClick={() => setPreset(id)} className={presetId === id ? "bg-accent" : ""}>
            {PRESET_LABELS[id]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {CALENDAR.map((id) => (
          <DropdownMenuItem key={id} onClick={() => setPreset(id)} className={presetId === id ? "bg-accent" : ""}>
            {PRESET_LABELS[id]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Custom</DropdownMenuLabel>
        <div className="px-2 py-1.5 flex items-center gap-1 text-xs">
          <input
            type="date"
            defaultValue={customFrom ?? range.from.toISOString().slice(0,10)}
            className="bg-muted border border-border rounded px-2 py-1 text-xs flex-1"
            onChange={(e) => {
              const to = customTo ?? range.to.toISOString().slice(0,10)
              if (e.target.value && to) setCustom(e.target.value, to)
            }}
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            defaultValue={customTo ?? range.to.toISOString().slice(0,10)}
            className="bg-muted border border-border rounded px-2 py-1 text-xs flex-1"
            onChange={(e) => {
              const from = customFrom ?? range.from.toISOString().slice(0,10)
              if (from && e.target.value) setCustom(from, e.target.value)
            }}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    {/* Reset visible cuando el filtro NO es el default → para no olvidarse un filtro puesto */}
    {!isDefault && (
      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Volver a Este mes" onClick={reset}>
        <X className="h-4 w-4" />
      </Button>
    )}
    </div>
  )
}
