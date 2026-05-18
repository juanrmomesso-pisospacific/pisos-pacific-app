import { Calendar } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { usePeriod } from "@/contexts/PeriodContext"
import { PRESET_LABELS, fmtRange, type PresetId } from "@/lib/period"

const ORDER: PresetId[] = ["month", "lastMonth", "quarter", "ytd", "lastYear"]

export function PeriodSelector() {
  const { presetId, range, setPreset, setCustom, customFrom, customTo } = usePeriod()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" className="gap-2">
          <Calendar className="h-3.5 w-3.5" />
          <span>{presetId === "custom" ? "Custom" : PRESET_LABELS[presetId]}</span>
          <span className="text-primary-foreground/70 text-xs ml-1">· {fmtRange(range)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Período</DropdownMenuLabel>
        {ORDER.map((id) => (
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
  )
}
