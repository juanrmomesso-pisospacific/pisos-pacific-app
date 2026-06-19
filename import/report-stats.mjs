// Resumen de un import (un solo pase sobre los movimientos ya marcados con _dupe).
// Usado por statements.mjs y mp-api.mjs.
export function reportStats(movements, { source, caja }) {
  let nuevos = 0, duplicados = 0, revisar = 0, ingresos = 0, egresos = 0, actualizan = 0, posibles = 0;
  for (const m of movements) {
    if (m._dupe) { duplicados++; continue; }
    if (m._enrich) actualizan++;
    else nuevos++;
    if (m._maybe) posibles++;
    if (m.needs_review) revisar++;
    if (m.flow === 'Ingreso') ingresos++;
    else if (m.flow === 'Egreso') egresos++;
  }
  return { source, caja, total: movements.length, nuevos, duplicados, revisar, ingresos, egresos, actualizan, posibles };
}
