// Claves de deduplicación de movimientos: FLUJO + fecha ±N días + |monto| redondeado.
// Compartido por statements.mjs (dedup + enriquecimiento) y mp-api.mjs.
// OJO: el flujo es parte de la clave — sin él, un COBRO nuevo que coincide en monto con un
// EGRESO ya cargado (±3 días, misma caja: jornales/señas redondos) quedaba marcado
// "ya cargado" y se descartaba en silencio al importar.
export const dedupKey = (d, a, flow = '') => flow + '|' + d + '|' + Math.round(Math.abs(a || 0));

// Genera las claves de la ventana [date-days, date+days] para un monto.
export function* windowKeys(dateStr, amount, flow = '', days = 3) {
  const base = new Date(dateStr);
  for (let o = -days; o <= days; o++) {
    const x = new Date(base);
    x.setDate(x.getDate() + o);
    yield dedupKey(x.toISOString().slice(0, 10), amount, flow);
  }
}
