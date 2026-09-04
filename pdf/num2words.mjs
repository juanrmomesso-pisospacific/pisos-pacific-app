// Número a letras en español (para recibos). Ej: 1505.63 USD →
// "DÓLARES MIL QUINIENTOS CINCO CON SESENTA Y TRES CENTAVOS".
const UNI = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
  'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE',
  'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS',
  'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DEC = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CEN = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
  'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

// 0..999 a palabras. apocope=true convierte "UNO"→"UN" (para "UN MIL"/"UN MILLÓN").
function centenasALetras(n, apocope) {
  if (n === 0) return '';
  if (n === 100) return 'CIEN';
  let out = '';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c) out += CEN[c] + (resto ? ' ' : '');
  if (resto) {
    if (resto < 30) out += UNI[resto];
    else {
      const d = Math.floor(resto / 10), u = resto % 10;
      out += DEC[d] + (u ? ' Y ' + UNI[u] : '');
    }
  }
  if (apocope) out = out.replace(/\bUNO\b/g, 'UN').replace(/\bVEINTIUNO\b/, 'VEINTIÚN');
  return out;
}

function enteroALetras(n) {
  if (n === 0) return 'CERO';
  let out = '';
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  if (millones) out += (millones === 1 ? 'UN MILLÓN' : centenasALetras(millones, true) + ' MILLONES') + ' ';
  if (miles) out += (miles === 1 ? 'MIL' : centenasALetras(miles, true) + ' MIL') + ' ';
  if (resto) out += centenasALetras(resto, false);
  return out.trim();
}

/**
 * Monto a letras con moneda. currency: 'USD' → DÓLARES · 'ARS' → PESOS.
 * Centavos en letras ("CON SESENTA Y TRES CENTAVOS"), como el recibo modelo.
 */
export function montoALetras(amount, currency = 'USD') {
  const n = Math.max(0, Number(amount) || 0);
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const moneda = currency === 'ARS' ? 'PESOS' : 'DÓLARES';
  const letras = enteroALetras(entero);
  const cent = centavos > 0 ? ` CON ${centenasALetras(centavos, false)} CENTAVOS` : '';
  return `${moneda} ${letras}${cent}`.trim();
}
