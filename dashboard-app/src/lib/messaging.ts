export type Channel = "whatsapp" | "instagram" | "email"

export type Conversation = {
  id: string
  channel: Channel
  contact_id: string
  contact_name: string
  linked_client_name?: string
  linked_lead_id?: string
  status: "open" | "closed"
  unread_count: number
  last_message_at: string
  last_message_preview?: string
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
  channel: Channel
  status: "approved" | "pending" | "rejected"
  body: string
}

export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp", instagram: "Instagram", email: "Email" }

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
