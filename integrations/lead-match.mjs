// Busca un lead existente que coincida con un contacto nuevo (para no duplicar leads
// cuando alguien escribe por varios canales o varias veces). Match por email, teléfono
// (últimos 8 dígitos) o, como último recurso, nombre completo exacto.
const digits = (s) => String(s || '').replace(/\D/g, '');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function findLeadMatch(leads, { name, phone, email } = {}) {
  const ph = digits(phone), em = norm(email), nm = norm(name);
  for (const l of leads || []) {
    if (em && norm(l.email) === em) return l;
    if (ph.length >= 8 && digits(l.phone).slice(-8) === ph.slice(-8)) return l;
  }
  // Nombre como último recurso: requiere nombre + apellido (con espacio, ≥5 chars) para evitar falsos positivos.
  if (nm && nm.length >= 5 && nm.includes(' ')) {
    for (const l of leads || []) if (norm(l.name) === nm) return l;
  }
  return null;
}
