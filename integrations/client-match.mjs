// Busca un cliente existente que coincida con uno nuevo (para no duplicar clientes).
// Match por email, teléfono (últimos 8 dígitos) o, como último recurso, nombre completo exacto.
// Espejo de integrations/lead-match.mjs, pero los clientes guardan emails[]/phones[] (arrays).
const digits = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const emailsOf = (c) => (Array.isArray(c.emails) ? c.emails : (c.email ? [c.email] : []));
const phonesOf = (c) => (Array.isArray(c.phones) ? c.phones : (c.phone ? [c.phone] : []));

export function findClientMatch(clients, { name, phone, email } = {}) {
  const ph = digits(phone), em = norm(email), nm = norm(name);
  for (const c of clients || []) {
    if (em && emailsOf(c).some((e) => norm(e) === em)) return c;
    if (ph.length >= 8 && phonesOf(c).some((p) => digits(p).slice(-8) === ph.slice(-8))) return c;
  }
  // Nombre como último recurso: requiere nombre + apellido (con espacio, ≥5 chars) para evitar falsos positivos.
  if (nm && nm.length >= 5 && nm.includes(' ')) {
    for (const c of clients || []) if (norm(c.name) === nm) return c;
  }
  return null;
}
