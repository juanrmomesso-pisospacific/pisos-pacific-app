// Tipo de cambio moneda local → USD compartido (server + importadores).
// Provider por config de la operación (multi-país): 'blue' = dólar blue AR (dolarapi,
// promedio compra/venta, cache 1h) · 'fixed' = tasa fija (país con moneda USD → 1).
// getBlueRate(): refresca (async). lastBlue(): valor sincrónico ya cacheado.
let cfg = { provider: 'blue', fallback: 1400, rate: 1 };
let cache = { v: 1400, at: 0 };

export function configureFx(currency = {}) {
  cfg = {
    provider: currency.fx_provider || 'blue',
    fallback: Number(currency.fx_fallback) || 1400,
    rate: Number(currency.fx_rate) || 1,
  };
  if (cache.at === 0) cache.v = cfg.provider === 'fixed' ? cfg.rate : cfg.fallback;
}

export async function getBlueRate() {
  if (cfg.provider === 'fixed') return cfg.rate;
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
export function lastBlue() { return cfg.provider === 'fixed' ? cfg.rate : cache.v; }
