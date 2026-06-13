// Parseo de reportes de gasto en efectivo por WhatsApp (Frente 2, parte ii).
// "gasto 29.000 ferretería" / "usd 50 nafta" / "29000 ferreteria" / "ferreteria" → partes.

// Normaliza un teléfono a sus últimos 10 dígitos (área + número) → robusto a 54 / 9 / +.
export function normalizePhone(s) {
  return String(s || '').replace(/\D/g, '').slice(-10);
}

// Inferencia liviana del tipo de gasto (misma lógica que el form de la app).
const INFER = [
  [/flete|acarreo|env[ií]o|cargo|log[ií]st|camion/i, 'Gastos de Instalaciones y Suministros'],
  [/ferret|tornill|silicon|pegament|adhesiv|herramient|insumo|clavo|cinta|madera|z[oó]calo/i, 'Gastos de Instalaciones y Suministros'],
  [/nafta|combustible|peaje|patente|seguro|service|goma|cubierta|estaci[oó]n|ypf|shell|axion/i, 'Gastos de Flota/Vehículos'],
  [/sueldo|jornal|colocad|mano de obra|adelanto|gast[oó]n|hugo|ariel|fabi[aá]n|oso|maldo/i, 'Gastos de Personal (HR y Mano de Obra)'],
  [/comida|almuerzo|caf[eé]|super|kiosco|merienda|agua/i, 'Gastos de Personal (HR y Mano de Obra)'],
  [/arca|afip|impuesto|tasa|sellado|ingresos brutos/i, 'Impuestos y Tasas'],
  [/alquiler|expensa|\bluz\b|\bgas\b|internet|tel[eé]fono/i, 'Gastos Administrativos'],
  [/marketing|publicidad|cartel|folleto|imprenta/i, 'Marketing y Ventas'],
];
export function inferType(desc) {
  for (const [re, t] of INFER) if (re.test(desc || '')) return t;
  return 'Gastos de Instalaciones y Suministros';
}

// Extrae { amount, currency, description } de un mensaje. amount=null si no hay número.
export function parseCashCommand(text) {
  let t = String(text || '').trim();
  let currency = /\b(usd|u\$s|d[oó]lares?|d[oó]lar)\b/i.test(t) ? 'USD' : null;
  // sacar palabras de comando y de moneda
  t = t.replace(/^\s*(gasto|gast[eé]|gaste)\b[:\s]*/i, '');
  t = t.replace(/\b(usd|u\$s|d[oó]lares?|d[oó]lar|pesos?|ars)\b/ig, ' ').trim();
  // primer número en formato AR ('.' miles, ',' decimal), con $ opcional
  let amount = null;
  const m = t.match(/\$?\s*\d[\d.,]*/);
  if (m) {
    const num = m[0].replace(/[$\s]/g, '').replace(/\./g, '').replace(/,/g, '.');
    const val = parseFloat(num);
    if (!isNaN(val) && val > 0) {
      amount = val;
      t = (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim();
    }
  }
  return { amount, currency, description: t.replace(/\s+/g, ' ').trim() };
}
