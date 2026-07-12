export type Channel = "whatsapp" | "instagram" | "email"

export type Conversation = {
  id: string
  channel: Channel
  contact_id: string
  contact_name: string
  linked_client_name?: string
  linked_lead_id?: string
  status: "open" | "closed"
  ignored?: boolean          // ignorada a mano (banco/robots): un entrante nuevo NO la reabre
  unread_count: number
  last_message_at: string
  last_message_preview?: string
  last_message_direction?: "in" | "out"   // 'in' = última del cliente → PENDIENTE de responder
  last_inbound_at?: string
  last_outbound_at?: string
  email_subject?: string   // asunto del hilo de email (para responder con "Re: …")
}

export type Message = {
  id: string
  conversation_id: string
  direction: "in" | "out"
  body: string
  ts: string
  status?: "sent" | "delivered" | "read" | "received"
  template_name?: string
  wa_id?: string            // id de mensaje de WhatsApp (dedup de echoes en Coexistence)
  via?: "wa-app" | "ig-app" // respondido desde la app del celular (WhatsApp / Instagram)
  media_url?: string        // adjunto entrante ya descargado (/uploads/…)
  media_type?: "image" | "video" | "audio" | "file"
}

export type Template = {
  id: string
  name: string
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
  language: string
  channel: Channel | "all" | "chat"   // "all" = cualquier canal · "chat" = WhatsApp + Instagram (no email)
  status: "approved" | "pending" | "rejected"
  body: string
  keywords?: string             // disparadores (csv) para sugerir según el mensaje recibido
  stage?: string                // etapa del proceso: consulta | presupuesto | seguimiento | cierre | postventa
}

// Etapas del proceso comercial (para plantillas y sugerencias por estado del lead).
export const STAGES = ["consulta", "presupuesto", "seguimiento", "cierre", "postventa"] as const
export const STAGE_LABEL: Record<string, string> = {
  consulta: "Consulta", presupuesto: "Presupuesto", seguimiento: "Seguimiento", cierre: "Cierre / cobro", postventa: "Post-venta",
}
// Estado del lead → etapas relevantes (la 1ra es la principal).
const STAGES_BY_LEAD: Record<string, string[]> = {
  New: ["consulta"],
  Contacted: ["consulta", "presupuesto"],
  Quoted: ["seguimiento", "cierre", "presupuesto"],
  Won: ["cierre", "postventa"],
  Lost: ["seguimiento"],
}

// Nombre técnico → etiqueta legible para los chips ("chat_precio_h2o" → "Precio h2o").
export function templateLabel(t: Template): string {
  const s = t.name.replace(/^(chat|email|tpl)[-_]/i, "").replace(/[-_]+/g, " ").trim()
  return s ? s[0].toUpperCase() + s.slice(1) : t.name
}

// ¿La plantilla aplica a este canal de conversación? "all" = todos; "chat" = WA/IG (no email).
export function templateMatchesChannel(tChannel: Template["channel"], channel: Channel): boolean {
  return tChannel === channel || tChannel === "all" || (tChannel === "chat" && (channel === "whatsapp" || channel === "instagram"))
}

// Sugerencias: rankea plantillas por (a) palabras clave del último mensaje del cliente y
// (b) la ETAPA del lead vinculado (un lead Cotizado sugiere seguimiento/cierre aunque el
// último mensaje no diga nada) — así las sugerencias acompañan todo el proceso, no solo
// la consulta inicial. Devuelve top N.
const normTxt = (s?: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
const STOPWORDS = new Set(["hola","buenas","gracias","para","como","que","con","los","las","una","por","del","sobre","quiero","necesito","tienen","tenes","hay","pero","esta","este","muy","mas"])
const SHORT_SIGNALS = new Set(["h2o", "m2", "iva"])   // tokens cortos que sí son señal fuerte
const isSignal = (w: string) => (w.length > 3 || SHORT_SIGNALS.has(w)) && !STOPWORDS.has(w)
export function suggestTemplates(templates: Template[], lastInbound: string, channel: Channel, opts: { leadStatus?: string; max?: number } = {}): Template[] {
  const max = opts.max ?? 3
  const text = normTxt(lastInbound)
  const stages = opts.leadStatus ? STAGES_BY_LEAD[opts.leadStatus] : undefined
  if (!text && !stages) return []
  const words = new Set(text.split(/[^a-z0-9]+/).filter(isSignal))
  return templates
    .filter((t) => templateMatchesChannel(t.channel, channel) && t.status === "approved")
    .map((t) => {
      let score = 0
      if (text) {
        for (const k of (t.keywords || "").split(",").map((x) => normTxt(x.trim())).filter(Boolean)) if (text.includes(k)) score += 3
        for (const w of normTxt(t.name + " " + t.body).split(/[^a-z0-9]+/)) if (isSignal(w) && words.has(w)) score += 1
      }
      if (t.stage && stages) {
        const i = stages.indexOf(t.stage)
        score += i === 0 ? 3 : i > 0 ? 2 : -2   // etapa principal +3, secundaria +2, otra etapa −2
      }
      return { t, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.t)
}

// Completa los placeholders de una plantilla con datos del contacto al insertarla.
// {{1}} y {nombre} → primer nombre del contacto; los demás {{n}} quedan para completar a mano.
export function fillTemplate(body: string, contactName?: string): string {
  const first = (contactName || "").replace(/^@/, "").trim().split(/\s+/)[0] || ""
  return (body || "").replace(/\{\{1\}\}/g, first).replace(/\{nombre\}/gi, first)
}

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", instagram: "Instagram", email: "Email" }

// "hace 3 días / hace 5 h / recién" — variante en palabras de relativeTime, para los chips
// de pendiente/enfriada (y cualquier otro "hace cuánto" en prosa).
export function agoLabel(iso?: string): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ""
  const d = Math.floor(ms / 86400e3)
  if (d >= 1) return `hace ${d} día${d > 1 ? "s" : ""}`
  const h = Math.floor(ms / 3600e3)
  return h >= 1 ? `hace ${h} h` : "recién"
}

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ""
  const diffSec = Math.round((Date.now() - t) / 1000)
  if (diffSec < 60) return "ahora"
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h`
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)} d`
  return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short" })
}

export const EMOJIS = ["👍", "🙏", "💪", "🔥", "✨", "🙌", "❤️", "✅", "📍", "📦", "📐", "🛠️", "😊", "😀", "🎉", "👋"]

// Ícono por canal/origen (Mensajes y Leads comparten esta lógica).
import { MessageCircle, AtSign, Mail, Globe } from "lucide-react"
export const channelIcon = (s: string) =>
  s === "whatsapp" ? MessageCircle : s === "instagram" ? AtSign : s === "email" ? Mail : s === "web" ? Globe : null
