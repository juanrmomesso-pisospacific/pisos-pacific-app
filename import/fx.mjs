// Cotización Dólar Blue compartida (server + importadores). Promedio compra/venta.
// getBlueRate(): refresca (async, cache 1h). lastBlue(): valor sincrónico ya cacheado (fallback 1400).
let cache = { v: 1400, at: 0 };

export async function getBlueRate() {
  if (Date.now() - cache.at < 3600e3) return cache.v;
  try {
    const r = await fetch('https://dolarapi.com/v1/dolares/blue', { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const v = Math.round((Number(j.compra) + Number(j.venta)) / 2);
    if (v > 0) cache = { v, at: Date.now() };
  } catch { /* mantener último/fallback */ }
  return cache.v;
}

// Último valor conocido (sin red). Los parsers sincrónicos lo usan; el server hace
// getBlueRate() antes para refrescarlo.
export function lastBlue() { return cache.v; }
