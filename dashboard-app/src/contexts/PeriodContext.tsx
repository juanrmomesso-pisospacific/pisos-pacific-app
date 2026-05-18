import { createContext, useContext, useMemo, useState } from "react"
import { presetRange, type PresetId, type Range } from "@/lib/period"

type PeriodCtx = {
  presetId: PresetId
  customFrom: string | null
  customTo: string | null
  setPreset: (id: PresetId) => void
  setCustom: (from: string, to: string) => void
  range: Range
}

const Ctx = createContext<PeriodCtx | null>(null)

export function PeriodProvider({ children }: { children: React.ReactNode }) {
  const [presetId, setPresetId] = useState<PresetId>("month")
  const [customFrom, setCustomFrom] = useState<string | null>(null)
  const [customTo, setCustomTo] = useState<string | null>(null)

  const range = useMemo<Range>(() => {
    if (presetId === "custom" && customFrom && customTo) {
      const from = new Date(customFrom + "T00:00:00")
      const to = new Date(customTo + "T23:59:59")
      return { from, to, label: "Custom" }
    }
    return presetRange(presetId)
  }, [presetId, customFrom, customTo])

  const value: PeriodCtx = {
    presetId,
    customFrom,
    customTo,
    setPreset: (id) => setPresetId(id),
    setCustom: (f, t) => { setCustomFrom(f); setCustomTo(t); setPresetId("custom") },
    range,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePeriod() {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePeriod must be used inside PeriodProvider")
  return v
}
