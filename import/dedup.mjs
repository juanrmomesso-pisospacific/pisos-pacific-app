// Claves de deduplicación de movimientos: fecha ±N días + |monto| redondeado.
// Compartido por statements.mjs (dedup + enriquecimiento) y mp-api.mjs.
export const dedupKey = (d, a) => d + '|' + Math.round(Math.abs(a || 0));

// Genera las claves de la ventana [date-days, date+days] para un monto.
export function* windowKeys(dateStr, amount, days = 3) {
  const base = new Date(dateStr);
  for (let o = -days; o <= days; o++) {
    const x = new Date(base);
    x.setDate(x.getDate() + o);
    yield dedupKey(x.toISOString().slice(0, 10), amount);
  }
}
