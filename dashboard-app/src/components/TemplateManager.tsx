import { useState } from "react"
import { Trash2, Plus, Pencil } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useApi } from "@/lib/api"
import { api, useAction, refresh } from "@/lib/mutations"
import { useConfirm } from "@/components/ui/confirm"
import { type Template, CHANNEL_LABEL, STAGES, STAGE_LABEL } from "@/lib/messaging"

const inputSel = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
const CHANNELS: { value: string; label: string }[] = [
  { value: "all", label: "Todos los canales" },
  { value: "chat", label: "Chat (WhatsApp + Instagram)" },
  { value: "whatsapp", label: CHANNEL_LABEL.whatsapp },
  { value: "instagram", label: CHANNEL_LABEL.instagram },
  { value: "email", label: CHANNEL_LABEL.email },
]
const channelLabel = (c: string) => CHANNELS.find((x) => x.value === c)?.label ?? c

// Plantillas / respuestas rápidas para el chat (Mensajes). Se insertan desde el composer.
export function TemplateManager() {
  const templates = useApi<Template[]>("/api/templates").data ?? []
  const create = useAction(api.create)
  const update = useAction(api.update)
  const del = useAction(api.remove)
  const confirm = useConfirm()

  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [channel, setChannel] = useState("all")
  const [body, setBody] = useState("")
  const [keywords, setKeywords] = useState("")
  const [stage, setStage] = useState("")

  const reset = () => { setEditId(null); setName(""); setChannel("all"); setBody(""); setKeywords(""); setStage("") }
  const startEdit = (t: Template) => { setEditId(t.id); setName(t.name); setChannel(t.channel); setBody(t.body); setKeywords(t.keywords || ""); setStage(t.stage || "") }

  const save = async () => {
    if (!name.trim() || !body.trim()) return
    const payload = { name: name.trim(), channel, body: body.trim(), keywords: keywords.trim(), stage: stage || null, status: "approved", category: "UTILITY", language: "es_AR" }
    const r = editId ? await update.run("templates", editId, payload) : await create.run("templates", payload)
    if (r) { reset(); refresh() }
  }
  const remove = async (t: Template) => {
    if (!(await confirm({ title: "Borrar plantilla", description: `Se elimina la plantilla "${t.name}".`, confirmLabel: "Borrar", destructive: true }))) return
    await del.run("templates", t.id); refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plantillas de mensajes</CardTitle>
        <CardDescription>Respuestas rápidas para el chat (Mensajes). Se insertan desde el botón de plantillas del chat. Usá <b>{"{nombre}"}</b> para que complete solo el nombre del cliente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* alta / edición */}
        <div className="rounded-md border border-border p-3 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej: Saludo inicial)" className="sm:flex-1" />
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputSel + " sm:w-52"}>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Texto del mensaje… (ej: Hola {nombre}, gracias por tu consulta!)"
            className="w-full resize-y rounded-md border border-input bg-transparent p-2 text-sm" />
          <div className="flex flex-col sm:flex-row gap-2">
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Palabras clave para sugerirla (ej: precio, presupuesto, cuánto sale)" className="sm:flex-1" />
            <select value={stage} onChange={(e) => setStage(e.target.value)} className={inputSel + " sm:w-52"} title="Etapa del proceso: se sugiere sola según el estado del lead (Nuevo→Consulta, Cotizado→Seguimiento/Cierre, Ganado→Cierre/Post-venta)">
              <option value="">Sin etapa</option>
              {STAGES.map((st) => <option key={st} value={st}>{STAGE_LABEL[st]}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={create.busy || update.busy || !name.trim() || !body.trim()} onClick={save}>
              {editId ? <><Pencil className="h-3.5 w-3.5" />Guardar cambios</> : <><Plus className="h-3.5 w-3.5" />Agregar plantilla</>}
            </Button>
            {editId && <Button size="sm" variant="ghost" onClick={reset}>Cancelar</Button>}
            {(create.error || update.error) && <span className="text-xs text-destructive">{create.error || update.error}</span>}
          </div>
        </div>

        <div className="text-xs text-muted-foreground">{templates.length} plantilla{templates.length === 1 ? "" : "s"}</div>
        <div className="divide-y divide-border rounded-md border border-border">
          {templates.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Todavía no hay plantillas.</div>
          ) : templates.map((t) => (
            <div key={t.id} className="flex items-start gap-2 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate flex items-center gap-2">{t.name}<Badge variant="outline" className="text-[10px] shrink-0">{channelLabel(t.channel)}</Badge>{t.stage ? <Badge variant="outline" className="text-[10px] shrink-0 text-amber-600 border-amber-300">{STAGE_LABEL[t.stage] ?? t.stage}</Badge> : null}</div>
                <div className="text-[11px] text-muted-foreground whitespace-pre-line line-clamp-2">{t.body}</div>
                {t.keywords ? <div className="text-[10px] text-muted-foreground mt-0.5">🔑 {t.keywords}</div> : null}
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => startEdit(t)} title="Editar"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => remove(t)} title="Borrar"><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
