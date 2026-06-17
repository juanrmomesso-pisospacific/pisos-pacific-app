// Timeout uniforme para llamadas a APIs externas (Meta, Gmail, MP, Google OAuth).
// Sin esto, una API lenta cuelga el request o deja un scheduler trabado para siempre.
export const withTimeout = (opts = {}, ms = 20000) => ({ ...opts, signal: AbortSignal.timeout(ms) });
