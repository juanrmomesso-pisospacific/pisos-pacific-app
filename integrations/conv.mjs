// Estado de respuesta de una conversación: dirección del último mensaje + timestamps por
// dirección. "Pendiente de responder" = last_message_direction === 'in'. NO toca unread_count
// (eso lo maneja cada caller: leído ≠ respondido). Se llama en TODO punto de escritura
// (entrantes WA/IG/email, salientes, eco IG, mirror de Gmail enviados).
export function touchConv(conv, direction, ts, preview) {
  if (!conv || !ts) return;
  if (!conv.last_message_at || ts >= conv.last_message_at) {
    conv.last_message_at = ts;
    if (preview != null) conv.last_message_preview = String(preview).slice(0, 140);
    conv.last_message_direction = direction;
  }
  if (direction === 'in') { if (!conv.last_inbound_at || ts > conv.last_inbound_at) conv.last_inbound_at = ts; }
  else { if (!conv.last_outbound_at || ts > conv.last_outbound_at) conv.last_outbound_at = ts; }
}
