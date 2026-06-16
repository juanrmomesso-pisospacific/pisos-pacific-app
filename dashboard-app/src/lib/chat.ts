// Encuentra la conversación de un contacto (por teléfono, email o nombre vinculado).
type Conv = { id: string; channel?: string; contact_id?: string; contact_name?: string; linked_client_name?: string }
export const digits = (s?: string) => (s || "").replace(/\D/g, "")

// Saludo por defecto al compartir un presupuesto. Igual al fallback del server (defaultQuoteMessage).
export function quoteShareMessage(quote: { client_name?: string; quote_number?: number | string }): string {
  const firstName = (quote.client_name || "").split(" ")[0]
  return `Hola${firstName ? " " + firstName : ""}, te comparto el presupuesto N${quote.quote_number} adjunto. Cualquier consulta quedo a disposición.`
}

export function findConvId(conversations: Conv[], who: { phone?: string; email?: string; name?: string }): string | null {
  const ph = digits(who.phone), em = (who.email || "").toLowerCase().trim(), nm = (who.name || "").trim().toLowerCase()
  for (const c of conversations) {
    const cid = c.contact_id || ""
    if (ph.length >= 8 && c.channel === "whatsapp" && digits(cid).endsWith(ph.slice(-8))) return c.id
    if (em && c.channel === "email" && cid.toLowerCase() === em) return c.id
    if (nm && ((c.linked_client_name || "").toLowerCase() === nm || (c.contact_name || "").toLowerCase() === nm)) return c.id
  }
  return null
}
