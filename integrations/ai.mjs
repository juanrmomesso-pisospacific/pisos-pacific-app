// Sugerencia de respuesta con IA (Anthropic, vía REST, sin SDK). On-demand: se llama solo
// cuando el vendedor toca "Sugerir respuesta". Requiere ANTHROPIC_API_KEY en el entorno.
import { withTimeout } from './http.mjs';

const MODEL = process.env.AI_MODEL || 'claude-sonnet-4-6';
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

const SYSTEM = `Sos un vendedor de Pisos Pacific, empresa argentina que importa y vende pisos de madera (ingeniería y maciza), hace la colocación y vende zócalos y accesorios. Redactá UNA respuesta breve, cordial y profesional en español rioplatense (voseo) al ÚLTIMO mensaje del cliente, en el tono de la marca: cercano pero serio.
Reglas:
- No inventes precios, plazos de entrega ni stock. Si falta info para responder, pedila o decí que lo averiguás y volvés.
- Es un chat (WhatsApp/Instagram/email): sin asunto ni firma.
- Máximo ~4 oraciones.
- Devolvé SOLO el texto de la respuesta, sin comillas ni explicaciones.`;

export async function suggestReply({ messages = [], contact, context }) {
  if (!aiConfigured()) throw new Error('IA no configurada (falta ANTHROPIC_API_KEY)');
  const convo = messages.map((m) => `${m.direction === 'in' ? 'Cliente' : 'Nosotros'}: ${m.body}`).join('\n');
  const userMsg = `Contacto: ${contact || 'cliente'}.${context ? '\n' + context : ''}\n\nConversación (la más reciente al final):\n${convo}\n\nRedactá la respuesta al último mensaje del cliente.`;
  const r = await fetch('https://api.anthropic.com/v1/messages', withTimeout({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
  }, 25000));
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`IA error ${r.status}: ${t.slice(0, 180)}`); }
  const j = await r.json();
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text) throw new Error('La IA no devolvió texto');
  return text;
}
