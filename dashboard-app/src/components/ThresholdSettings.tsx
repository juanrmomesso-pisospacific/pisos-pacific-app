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

type SettingsResp = { dashboardThresholds?: Thresholds; anticipo_pct?: number }

const DEFAULT_THRESHOLDS: Thresholds = { lateDeliveryDays: 7, overdueCobroDays: 30, conversionWindowDays: 90, lowStockUnits: 5 }

// lateDeliveryDays quedó sin consumidor (se conserva en settings) → no se muestra.
const FIELDS: { key: keyof Thresholds; label: string; hint: string }[] = [
  { key: "overdueCobroDays",     label: "Días para considerar cobro vencido", hint: "En Cobranzas, una obra entregada sin cobrar se marca en rojo pasados estos días desde la finalización." },
  { key: "conversionWindowDays", label: "Ventana de conversión (días)", hint: "Período del Embudo comercial para calcular el % de cotizaciones aceptadas." },
  { key: "lowStockUnits",        label: "Umbral de stock crítico (m²)", hint: "Disponible mínimo antes de contar un producto como crítico en Cobertura de stock." },
]

export function ThresholdSettings() {
  const { data } = useApi<SettingsResp>("/api/settings")
  const [draft, setDraft] = useState<Thresholds | null>(null)
  const [anticipo, setAnticipo] = useState<number | null>(null)   // en % (0-100)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  useEffect(() => {
    if (data && !draft) {
      setDraft({ ...DEFAULT_THRESHOLDS, ...(data.dashboardThresholds || {}) })
      setAnticipo(Math.round((data.anticipo_pct ?? 0.8) * 100))
    }
  }, [data, draft])

  if (!draft || anticipo == null) return null

  async function save() {
    setSaving(true); setSavedOk(false)
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardThresholds: draft, anticipo_pct: Math.min(100, Math.max(0, anticipo ?? 80)) / 100 }),
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
          <div>
            <label className="text-sm font-medium block mb-1">Anticipo estándar (%)</label>
            <Input
              type="number" min={0} max={100}
              value={anticipo}
              onChange={(e) => setAnticipo(Number(e.target.value) || 0)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Término de pago (Anticipo {anticipo}% · Conforme {100 - anticipo}%). En Cobranzas, una venta sin finalizar con menos de este % cobrado cuenta como "Anticipo incompleto"; con el % pagado queda "Esperando obra" (sin alarma).
            </p>
          </div>
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
