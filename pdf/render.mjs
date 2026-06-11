// Motor de PDF en Node puro (pdfkit) — reemplaza al pipeline Python/reportlab que
// no corre en producción. Implementa el diseño aprobado "V10 · Cabezal oscuro"
// (handoff 10/06): banda oscura con lockup, partes + observaciones, secciones por
// área, totales, términos y footer — SIEMPRE en una sola página A4 (auto-fit).
//
// Coordenadas: el diseño está especificado en px sobre una hoja de 720×1018.
// Dibujamos en "espacio px" con doc.scale(PX) (1 unidad = 1px del diseño).
// El cuerpo se escala además por `fit` (≤1) compensando el ancho, igual que el
// transform: scale(var(--fit)) del prototipo.

import PDFDocument from 'pdfkit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSET = (f) => path.join(__dirname, 'assets', f);
const FONT = (f) => path.join(__dirname, 'fonts', f);

// ---- Tokens del diseño ----
const PX = 595.28 / 720;                  // pt por px de diseño (A4 width / 720)
const PAGE = { w: 720, h: 1018 };         // hoja en px de diseño
const C = {
  ink: '#2a2723', ink2: '#6c665b', ink3: '#9a9486',
  hair: '#cfc8ba', wood: '#5b564d', paper: '#ffffff',
};
const PADX = 30;                          // padding horizontal de página
const BODY_W = PAGE.w - PADX * 2;         // 660

// Fuentes en memoria (se leen del disco una sola vez, no por PDF).
import fs from 'node:fs';
const FONT_BUFS = {
  reg: fs.readFileSync(FONT('inter-400.otf')),
  semi: fs.readFileSync(FONT('inter-600.otf')),
  bold: fs.readFileSync(FONT('inter-700.otf')),
};

function newDoc() {
  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  // Anula la auto-paginación de pdfkit: dibujamos con transforms (scale) que pdfkit
  // no contempla al decidir saltos de página. El MediaBox A4 ya quedó fijado al crear
  // la página; agrandar height solo afecta maxY() (el chequeo de desborde).
  doc.page.height = 1e6;
  for (const [name, buf] of Object.entries(FONT_BUFS)) doc.registerFont(name, buf);
  return doc;
}
const toBuffer = (doc) => new Promise((resolve, reject) => {
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
  doc.end();
});

// Texto de una línea con tracking, sin wrap. align: 'left'|'right' respecto de x.
function line(doc, str, x, y, { font = 'reg', size = 12, color = C.ink, cs = 0, align = 'left', opacity = 1 } = {}) {
  doc.font(font).fontSize(size);
  const w = doc.widthOfString(str, { characterSpacing: cs });
  const tx = align === 'right' ? x - w : x;
  doc.fillColor(color).fillOpacity(opacity).text(str, tx, y, { lineBreak: false, characterSpacing: cs });
  doc.fillOpacity(1);
  return w;
}
// Texto multilínea (wrap) dentro de un ancho. Devuelve la altura.
function para(doc, str, x, y, w, { font = 'reg', size = 12, color = C.ink, draw = true } = {}) {
  doc.font(font).fontSize(size);
  const h = doc.heightOfString(str, { width: w });
  if (draw) doc.fillColor(color).text(str, x, y, { width: w });
  return h;
}
const hline = (doc, x1, y, x2, color = C.hair, lw = 1) =>
  doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(color).stroke();

// ===================== PRESUPUESTO — Cabezal oscuro =====================
// data = salida de presupuestoData() en server.js (strings ya formateados es-AR).
export async function presupuestoPdf(data) {
  const doc = newDoc();
  doc.save();
  doc.scale(PX);                                    // espacio px de diseño

  // --- 1. Masthead (banda oscura, full bleed, 82px de alto) ---
  const MH = 82;
  doc.rect(0, 0, PAGE.w, MH).fill(C.ink);
  doc.image(ASSET('pacific_lockup_arg_white.png'), PADX, 22, { height: 38 });
  const R = PAGE.w - PADX;
  line(doc, 'PRESUPUESTO PRELIMINAR', R, 25, { font: 'semi', size: 12, color: '#ffffff', cs: 2.4, align: 'right', opacity: 0.9 });
  // meta: N° · Emisión · Vence (vence resaltado)
  const meta = [
    { t: `N° ${data.numero || '—'}`, hot: false },
    { t: `Emisión ${data.fecha || ''}`, hot: false },
    { t: `Vence ${data.vence || ''}`, hot: true },
  ];
  doc.font('reg').fontSize(11.5);
  let mx = R;
  for (let i = meta.length - 1; i >= 0; i--) {
    const m = meta[i];
    const f = m.hot ? 'semi' : 'reg';
    doc.font(f).fontSize(11.5);
    const w = doc.widthOfString(m.t);
    mx -= w;
    doc.fillColor('#ffffff').fillOpacity(m.hot ? 1 : 0.7).text(m.t, mx, 47, { lineBreak: false });
    mx -= 18;
  }
  doc.fillOpacity(1);

  // --- 2. Cuerpo con auto-fit a una página ---
  const bodyTop = MH + 22;
  const AVAIL = PAGE.h - bodyTop - 24;              // alto disponible del cuerpo
  const GAP = 13;

  // Normalización de datos → secciones
  const sections = data.mode === 'sections'
    ? (data.sections || []).map((s) => ({ name: s.title, sub: s.subtotal_val, rows: s.rows }))
    : [{ name: 'Detalle', sub: data.subtotal, rows: data.rows || [] }];
  const hasIva = data.has_iva && data.iva && !/^US\$ ?0(,00)?$/.test(data.iva);
  const terms = [
    { k: 'Forma de pago', v: data.forma_pago || 'Anticipo 80% · Conforme 20%' },
    { k: 'Valores', v: 'Dólares billete, promedio dos puntas' },
    { k: 'Vigencia', v: `${data.vigencia_dias || 10} días corridos desde la emisión` },
    { k: 'Garantía', v: 'Válida si la instalación la realiza Pisos Pacific' },
  ];
  const isFree = (r) => /^US\$ ?0(,00)?$/.test(String(r[3] || '')) && !/^descuento/i.test(String(r[0] || ''));
  const isDisc = (r) => /^descuento/i.test(String(r[0] || ''));

  // ---- bloques: cada uno mide (draw=false) o dibuja (draw=true) y devuelve su alto ----
  const GRID = { q: 56, u: 70, t: 84, gap: 8 };

  const blockParties = (draw, w, y0) => {
    const colW = (w - 18) / 2;
    let ly = y0;
    for (const [lbl, val] of [['CLIENTE', data.cliente || '—'], ['OBRA / DIRECCIÓN', data.obra || '—']]) {
      if (draw) line(doc, lbl.toUpperCase(), 0, ly, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19 });
      ly += 8.5 * 1.25 + 2;
      const vh = para(doc, String(val), 0, ly, colW, { font: 'semi', size: 13.5, color: C.ink, draw });
      ly += vh + 11;
    }
    const leftH = ly - y0 - 11;
    // Observaciones (caja) a la derecha
    const obs = data.obs || '—';
    const bx = colW + 18, bw = colW;
    doc.font('reg').fontSize(12);
    const th = doc.heightOfString(String(obs), { width: bw - 24 });
    const bh = 9 + 8.5 * 1.25 + 3 + th + 9;
    if (draw) {
      doc.roundedRect(bx, y0, bw, bh, 4).lineWidth(1).strokeColor(C.hair).stroke();
      line(doc, 'OBSERVACIONES', bx + 12, y0 + 9, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19 });
      para(doc, String(obs), bx + 12, y0 + 9 + 8.5 * 1.25 + 3, bw - 24, { size: 12, color: C.ink2 });
    }
    return Math.max(leftH, bh) + 18;                // padding-bottom 18
  };

  const blockSections = (draw, w, y0) => {
    let y = y0;
    const dW = w - GRID.q - GRID.u - GRID.t - GRID.gap * 3;
    const xU = w - GRID.t - GRID.gap - GRID.u;
    const xQ = xU - GRID.gap - GRID.q;
    sections.forEach((sec, si) => {
      if (si > 0) y += 24;
      // head
      if (draw) {
        line(doc, String(sec.name || '').toUpperCase(), 0, y, { font: 'bold', size: 11, color: C.wood, cs: 1.54 });
        line(doc, String(sec.sub || ''), w, y, { font: 'semi', size: 12.5, color: C.ink, align: 'right' });
      }
      y += 12.5 * 1.25 + 5;
      if (draw) hline(doc, 0, y, w, C.wood, 1);
      y += 1;
      // header de columnas (solo primera sección)
      if (si === 0) {
        y += 4;
        if (draw) {
          line(doc, 'DESCRIPCIÓN', 0, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 0.85 });
          line(doc, 'CANT.', xQ + GRID.q, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 0.85, align: 'right' });
          line(doc, 'P. UNIT.', xU + GRID.u, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 0.85, align: 'right' });
          line(doc, 'TOTAL', w, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 0.85, align: 'right' });
        }
        y += 8.5 * 1.25 + 4;
      }
      // filas
      for (const r of sec.rows || []) {
        const [d, q, u, t] = [String(r[0] ?? ''), String(r[1] ?? '').replace(/\bm2\b/g, 'm²'), String(r[2] ?? ''), String(r[3] ?? '')];
        y += 4;
        doc.font('reg').fontSize(12);
        const dh = doc.heightOfString(d, { width: dW });
        if (draw) {
          para(doc, d, 0, y, dW, { size: 12, color: isDisc(r) ? C.ink3 : C.ink });
          line(doc, q, xQ + GRID.q, y, { size: 12, color: C.ink2, align: 'right' });
          line(doc, u, xU + GRID.u, y, { size: 12, color: C.ink2, align: 'right' });
          if (isFree(r)) line(doc, 'Bonificado', w, y, { size: 12, color: C.ink3, align: 'right' });
          else line(doc, t, w, y, { font: 'semi', size: 12, color: C.ink, align: 'right' });
        }
        y += Math.max(dh, 12 * 1.25) + 4;
        if (draw) hline(doc, 0, y, w, C.hair, 1);
        y += 1;
      }
    });
    return y - y0;
  };

  const blockTotals = (draw, w, y0) => {
    const tw = 320, x0 = w - tw;
    let y = y0;
    if (hasIva) {
      for (const [lbl, val] of [['Subtotal general', data.subtotal], ['IVA 21%', data.iva]]) {
        if (draw) {
          line(doc, lbl, x0, y, { size: 12, color: C.ink2 });
          line(doc, String(val || ''), w, y, { font: 'semi', size: 12, color: C.ink, align: 'right' });
        }
        y += 12 * 1.25 + 6;
      }
      y += 8;
    }
    if (draw) hline(doc, x0, y, w, C.ink, 1.5);
    y += 10;
    if (draw) {
      line(doc, hasIva ? 'TOTAL C/IVA' : 'TOTAL', x0, y + 8, { font: 'semi', size: 10, color: C.ink2, cs: 1.6 });
      line(doc, String(data.total || ''), w, y, { font: 'bold', size: 23, color: C.ink, align: 'right' });
    }
    y += 23 * 1.2;
    return y - y0;
  };

  const blockBottom = (draw, w, y0) => {
    let y = y0 + 18;                                 // margin-top
    if (draw) hline(doc, 0, y, w, C.hair, 1);
    y += 16;
    const colW = (w - 22 * 3) / 4;
    let rowH = 0;
    terms.forEach((t, i) => {
      const x = i * (colW + 22);
      if (draw) line(doc, t.k.toUpperCase(), x, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.02 });
      doc.font('reg').fontSize(11);
      const vh = doc.heightOfString(t.v, { width: colW });
      if (draw) para(doc, t.v, x, y + 8.5 * 1.25 + 3, colW, { size: 11, color: C.ink2 });
      rowH = Math.max(rowH, 8.5 * 1.25 + 3 + vh);
    });
    y += rowH + 14;
    if (draw) hline(doc, 0, y, w, C.hair, 1);
    y += 13;
    if (draw) {
      line(doc, 'CONTACTO', 0, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.02 });
      line(doc, data.vendedor || 'Pisos Pacific', 0, y + 8.5 * 1.25 + 4, { font: 'semi', size: 12.5, color: C.ink });
      line(doc, 'pisospacific.com', w, y + 8.5 * 1.25 + 4 + 2, { font: 'semi', size: 10.5, color: C.ink2, cs: 0.42, align: 'right' });
    }
    y += 8.5 * 1.25 + 4 + 12.5 * 1.25;
    return y - y0;
  };

  // ---- medir (fit=1) → calcular fit y spacer → dibujar ----
  const blocks = [blockParties, blockSections, blockTotals, blockBottom];
  const heights = blocks.map((b) => b(false, BODY_W, 0));
  const natural = heights.reduce((a, b) => a + b, 0) + GAP * (blocks.length - 1);
  const fit = Math.min(1, AVAIL / natural);
  const w = BODY_W / fit;
  const spacer = fit < 1 ? 0 : AVAIL - natural;     // el aire cae antes de los totales

  doc.translate(PADX, bodyTop);
  doc.scale(fit);
  let y = 0;
  y += blockParties(true, w, y) + GAP;
  y += blockSections(true, w, y) + GAP + spacer;
  y += blockTotals(true, w, y) + GAP;
  blockBottom(true, w, y);

  doc.restore();
  return toBuffer(doc);
}

// ===================== REMITO (sin precios) =====================
// Mismo lenguaje visual: banda oscura + tabla MATERIAL/CANTIDAD. data = remitoData().
export async function remitoPdf(data) {
  const doc = newDoc();
  doc.save();
  doc.scale(PX);

  const MH = 82, R = PAGE.w - PADX;
  doc.rect(0, 0, PAGE.w, MH).fill(C.ink);
  doc.image(ASSET('pacific_lockup_arg_white.png'), PADX, 22, { height: 38 });
  line(doc, 'REMITO · PREPARACIÓN DE ENTREGA', R, 25, { font: 'semi', size: 12, color: '#ffffff', cs: 2.4, align: 'right', opacity: 0.9 });
  line(doc, `Emisión ${data.fecha || ''}`, R, 47, { size: 11.5, color: '#ffffff', opacity: 0.7, align: 'right' });

  let y = MH + 26;
  // Badge SIN VALORES
  doc.font('semi').fontSize(8.5);
  const bt = 'SIN VALORES';
  const btw = doc.widthOfString(bt, { characterSpacing: 1 });
  doc.roundedRect(R - btw - 20, y - 4, btw + 20, 20, 3).lineWidth(1).strokeColor(C.ink).stroke();
  line(doc, bt, R - btw - 10, y + 1, { font: 'semi', size: 8.5, color: C.ink, cs: 1 });
  // Obra
  para(doc, data.obra || data.cliente || '', PADX, y, BODY_W - btw - 40, { font: 'bold', size: 22, color: C.ink });
  y += 40;
  for (const [lbl, val] of [['CLIENTE', data.cliente], ['DIRECCIÓN DE OBRA', data.direccion], ['EQUIPO DE COLOCACIÓN', data.equipo], ['FECHA DE ENTREGA', data.entrega]]) {
    line(doc, lbl, PADX, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19 });
    line(doc, String(val || '—'), PADX + 170, y - 1.5, { font: 'semi', size: 12.5, color: C.ink });
    y += 22;
  }
  y += 6;
  hline(doc, PADX, y, R, C.hair, 1); y += 18;
  // Tabla
  line(doc, 'MATERIAL', PADX, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19 });
  line(doc, 'CANTIDAD', R, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19, align: 'right' });
  y += 8.5 * 1.25 + 5;
  hline(doc, PADX, y, R, C.wood, 1); y += 6;
  // Filas con tope: descripción máx. 2 líneas (con …) y corte antes del área de firmas.
  const rows = data.rows || [];
  const yLimit = PAGE.h - 130;                       // no pisar firmas/footer
  const maxDescH = 12 * 1.25 * 2;                    // 2 líneas
  for (let i = 0; i < rows.length; i++) {
    if (y > yLimit - 30 && i < rows.length - 1) {
      line(doc, `… y ${rows.length - i} ítems más (ver venta en la app)`, PADX, y, { size: 11, color: C.ink3 });
      y += 20;
      break;
    }
    const [d, qt] = [String(rows[i][0] ?? ''), String(rows[i][1] ?? '')];
    doc.font('reg').fontSize(12);
    const dh = Math.min(doc.heightOfString(d, { width: BODY_W - 140 }), maxDescH);
    doc.fillColor(C.ink).text(d, PADX, y, { width: BODY_W - 140, height: maxDescH, ellipsis: true });
    line(doc, qt, R, y, { font: 'semi', size: 12, color: C.ink, align: 'right' });
    y += Math.max(dh, 15) + 5;
    hline(doc, PADX, y, R, C.hair, 1); y += 5;
  }
  if (data.obs) {
    y += 14;
    line(doc, 'NOTAS', PADX, y, { font: 'semi', size: 8.5, color: C.ink3, cs: 1.19 });
    para(doc, String(data.obs), PADX + 60, y - 1.5, BODY_W - 60, { size: 11, color: C.ink2 });
  }
  // Firmas + footer (ancladas abajo)
  const fy = PAGE.h - 90;
  line(doc, 'Preparado por: __________________', PADX, fy, { size: 10.5, color: C.ink3 });
  line(doc, 'Recibido: __________________', PADX + BODY_W * 0.55, fy, { size: 10.5, color: C.ink3 });
  hline(doc, PADX, fy + 28, R, C.hair, 1);
  line(doc, 'pisospacific.com', PADX, fy + 40, { font: 'semi', size: 10.5, color: C.ink2 });
  line(doc, data.fecha || '', R, fy + 40, { size: 10.5, color: C.ink3, align: 'right' });

  doc.restore();
  return toBuffer(doc);
}

export function generatePdf(data) {
  return data?.doc_type === 'remito' ? remitoPdf(data) : presupuestoPdf(data);
}
