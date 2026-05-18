import { useState, useEffect } from "react"
import { Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api"

type Thresholds = {
  lateDeliveryDays: number
  overdueCobroDays: number
  conversionWindowDays: number
  lowStockUnits: number
}

type SettingsResp = { dashboardThresholds?: Thresholds }

const FIELDS: { key: keyof Thresholds; label: string; hint: string }[] = [
  { key: "conversionWindowDays", label: "Ventana de conversión (días)", hint: "Período usado para calcular % de conversión y demanda reciente para alertas." },
  { key: "overdueCobroDays",     label: "Días para considerar cobro vencido", hint: "Marca rojo los saldos abiertos cuya antigüedad supera este valor." },
  { key: "lateDeliveryDays",     label: "Días para entrega tardía", hint: "Si la fecha de entrega supera estos días sin despachar, aparece como atrasada." },
  { key: "lowStockUnits",        label: "Umbral de stock bajo", hint: "Cantidad mínima de m² antes de marcar un producto como stock bajo." },
]

export function ThresholdSettings() {
  const { data } = useApi<SettingsResp>("/api/settings")
  const [draft, setDraft] = useState<Thresholds | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  useEffect(() => {
    if (data?.dashboardThresholds && !draft) setDraft(data.dashboardThresholds)
  }, [data, draft])

  if (!draft) return null

  async function save() {
    setSaving(true); setSavedOk(false)
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardThresholds: draft }),
      })
      setSavedOk(true)
      setTimeout(() => window.location.reload(), 600)
    } finally { setSaving(false) }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" aria-label="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Configuración del Dashboard</SheetTitle>
          <SheetDescription>Umbrales que controlan alertas y métricas. Se aplican inmediatamente al guardar.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-sm font-medium block mb-1">{f.label}</label>
              <Input
                type="number"
                min={1}
                value={draft[f.key]}
                onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground mt-1">{f.hint}</p>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
            {savedOk ? <span className="text-xs text-emerald-400">Guardado · recargando</span> : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
