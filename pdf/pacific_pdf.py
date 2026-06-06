"""
pacific_pdf.py
==============
Motor de generación de presupuestos PDF — Pisos Pacific.

DEPENDENCIAS
------------
    pip install reportlab pillow

USO MÍNIMO
----------
    from pacific_pdf import generate_pdf

    pdf_bytes = generate_pdf(data)
    # pdf_bytes es un objeto bytes listo para:
    #   - Guardar en disco:            open("presupuesto.pdf", "wb").write(pdf_bytes)
    #   - Devolver en una API (Flask):  send_file(BytesIO(pdf_bytes), mimetype="application/pdf")
    #   - Devolver en Django:           HttpResponse(pdf_bytes, content_type="application/pdf")

ESTRUCTURA DEL OBJETO `data`
----------------------------
{
  # ── Cabecera ──────────────────────────────────────────────────────
  "fecha":          str,   # "19/05/2026"
  "vendedor":       str,   # "Juan Rodriguez Momesso · 15 5175 0087"
  "vendedor_short": str,   # "Juan Rodriguez Momesso"  (aparece en banda cliente)
  "cliente":        str,   # Nombre del cliente
  "obra":           str,   # Dirección o nombre de obra
  "obs":            str,   # Observaciones (opcional, puede ser "" o None)

  # ── Modo ──────────────────────────────────────────────────────────
  #   "single"   → una sola tabla, sin separación por zonas
  #   "sections" → tabla separada por zonas, cada una con subtotal propio
  "mode": "single" | "sections",

  # ── Ítems (modo "single") ─────────────────────────────────────────
  # Requerido solo cuando mode == "single"
  "rows": [
    (descripcion, cantidad, precio_unit, total),
    # Ejemplos:
    ("H2OHD XL - Natural Oak 6,5mm x 23cm x 1,50m", "120 m2", "US$ 38,00", "US$ 4.560,00"),
    ("Servicio de Entrega",                           "—",      "—",          "US$   250,00"),
    ("Nylon Manta 200 Micrones",                      "120 m2", "US$ 0,00",  "Bonificado"),
  ],

  # ── Secciones (modo "sections") ───────────────────────────────────
  # Requerido solo cuando mode == "sections"
  "sections": [
    {
      "title":          str,   # "Planta Baja" / "Planta Alta" / "Escaleras" / lo que sea
      "rows": [
        (descripcion, cantidad, precio_unit, total),
        ...
      ],
      "subtotal_label": str,   # "Subtotal Planta Baja"
      "subtotal_val":   str,   # "US$ 2.899,60"
    },
    ...
  ],

  # ── Totales (siempre requeridos) ───────────────────────────────────
  # La plataforma calcula estos valores; el motor los recibe ya formateados.
  "subtotal": str,   # "US$ 9.883,09"  — suma de todos los ítems sin IVA
  "iva":      str,   # "US$ 2.075,45"  — subtotal * 0.21
  "total":    str,   # "US$ 11.958,54" — subtotal + iva
}

LOGO
----
Colocar el archivo "pacific_logo.png" en la misma carpeta que este script,
o ajustar LOGO_PATH a la ruta absoluta correcta en el servidor.

El logo debe ser:
  - Formato PNG (fondo blanco o transparente)
  - Dimensiones originales aprox. 1022 × 306 px  (ratio 3.34 : 1)
  - Versión en negro sobre blanco

JERARQUÍA VISUAL DEL PDF (aprobada por Pacific)
-------------------------------------------------
  Logo Pacific (PNG real)
  ─────────────────────────────────────────────
  PRESUPUESTO PRELIMINAR
  Cliente / Obra / Vendedor
  Observaciones
  ─────────────────────────────────────────────
  [Por zona si mode=="sections":]
    ▌ NOMBRE DE ZONA
      DESCRIPCION | CANT/UND | P.UNIT. | TOTAL   ← fondo gris suave
      ítem 1                                       ← fondo blanco
      ítem 2
      SUBTOTAL ZONA          US$ X.XXX,XX          ← grande (13pt), fondo gris
  [Si mode=="single": una sola tabla sin títulos de zona]

  SUBTOTAL (GENERAL)         US$ X.XXX,XX          ← grande (13pt), fondo gris
  IVA 21%                    US$ X.XXX,XX          ← discreto
  ─────────────────────────────
  TOTAL C/IVA                US$ X.XXX,XX          ← moderado (10pt)
  ─────────────────────────────────────────────
  Condiciones comerciales
  Footer: web · vendedor · fecha
"""

import io
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

# ── Ruta al logo ─────────────────────────────────────────────────────
# Ajustar a la ruta real en el servidor de producción
LOGO_PATH = os.path.join(os.path.dirname(__file__), "pacific_logo.png")

# ── Paleta de colores ────────────────────────────────────────────────
INK   = colors.HexColor("#1a1a1a")   # texto principal
MID   = colors.HexColor("#555555")   # texto secundario / números
MUTED = colors.HexColor("#999999")   # labels, hints, IVA
RULE  = colors.HexColor("#e0dcd8")   # líneas separadoras
BGCOL = colors.HexColor("#f2f0ed")   # fondo: col-header + subtotales
WHITE = colors.white

# ── Escala tipográfica unificada ─────────────────────────────────────
FS_LABEL = 7     # labels en mayúsculas, IVA, footer, condiciones
FS_BODY  = 8     # texto, valores, filas
FS_TITLE = 9     # "PRESUPUESTO PRELIMINAR" / títulos de zona
FS_TOTAL = 11    # TOTAL C/IVA
FS_SUB   = 12    # subtotales prominentes

# ── Plantillas (variantes de diseño) ─────────────────────────────────
# Seleccionables vía data["template"]. Cada una mantiene el layout aprobado
# y cambia el color de acento + el tratamiento del bloque de Total.
STYLES = {
    "clasico":  {"accent": None,                          "total": "flat"},   # B&N minimal (actual)
    "calido":   {"accent": colors.HexColor("#9b7a4f"),   "total": "accent"}, # acento bronce/madera + total en banda
    "moderno":  {"accent": colors.HexColor("#1a1a1a"),   "total": "dark"},   # alto contraste + total en banda oscura
}

# ── Medidas de página ────────────────────────────────────────────────
W, H = A4                # 595 × 842 pt
L    = 18 * mm           # margen izquierdo
R    = W - 18 * mm       # borde derecho
CW   = R - L             # ancho útil


def _remito(data: dict) -> bytes:
    """Remito para el depósito: dirección de obra + materiales y cantidades, SIN precios."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    logo_w = 58 * mm
    logo_h = logo_w / (1022 / 306)
    c.drawImage(LOGO_PATH, L, H - 8*mm - logo_h, width=logo_w, height=logo_h, mask="auto")
    c.setFillColor(INK); c.setFont("Helvetica-Bold", FS_BODY)
    c.drawRightString(R, H - 13*mm, data.get("fecha", ""))
    c.setStrokeColor(RULE); c.setLineWidth(0.8)
    c.line(L, H - 8*mm - logo_h - 3*mm, R, H - 8*mm - logo_h - 3*mm)
    y = H - 8*mm - logo_h - 9*mm
    # Eyebrow + badge "SIN VALORES"
    c.setFillColor(MUTED); c.setFont("Helvetica", FS_LABEL); c._charSpace = 2
    c.drawString(L, y, "REMITO  ·  PREPARACIÓN DE ENTREGA"); c._charSpace = 0
    badge = "SIN VALORES"
    c.setFont("Helvetica-Bold", FS_LABEL)
    tw = c.stringWidth(badge, "Helvetica-Bold", FS_LABEL); bw, bh = tw + 7*mm, 5.2*mm
    c.setStrokeColor(INK); c.setLineWidth(0.8)
    c.roundRect(R - bw, y - 1.4*mm, bw, bh, 1.2*mm, fill=0, stroke=1)
    c.setFillColor(INK); c._charSpace = 0.5
    c.drawCentredString(R - bw/2, y + 0.4*mm, badge); c._charSpace = 0
    y -= 8 * mm
    c.setFillColor(INK); c.setFont("Helvetica-Bold", 18)
    c.drawString(L, y, data.get("obra") or data.get("cliente", "")); y -= 9 * mm
    # Datos
    for label, val in [("CLIENTE", data.get("cliente")), ("DIRECCIÓN DE OBRA", data.get("direccion")),
                       ("EQUIPO DE COLOCACIÓN", data.get("equipo")), ("FECHA DE ENTREGA", data.get("entrega"))]:
        c.setFillColor(MUTED); c.setFont("Helvetica", FS_LABEL); c._charSpace = 1.2
        c.drawString(L, y, label); c._charSpace = 0
        c.setFillColor(INK); c.setFont("Helvetica-Bold", FS_BODY)
        c.drawString(L + 42*mm, y, val or "—"); y -= 6 * mm
    y -= 2 * mm
    c.setStrokeColor(RULE); c.setLineWidth(0.6); c.line(L, y, R, y); y -= 8 * mm
    # Tabla: MATERIAL | CANTIDAD (sin precios)
    c.setFillColor(BGCOL); c.rect(L, y - 5.5*mm, CW, 5.5*mm, fill=1, stroke=0)
    c.setFillColor(MUTED); c.setFont("Helvetica", FS_LABEL); c._charSpace = 1
    c.drawString(L + 3*mm, y - 3.6*mm, "MATERIAL")
    c.drawRightString(R - 3*mm, y - 3.6*mm, "CANTIDAD"); c._charSpace = 0
    y -= 5.5 * mm
    for row in data.get("rows", []):
        desc, cant = (row + ["", ""])[:2]
        c.setFillColor(WHITE); c.rect(L, y - 7*mm, CW, 7*mm, fill=1, stroke=0)
        c.setFillColor(INK); c.setFont("Helvetica", FS_BODY)
        txt = str(desc)
        while c.stringWidth(txt, "Helvetica", FS_BODY) > CW * 0.72 and len(txt) > 4:
            txt = txt[:-2]
        c.drawString(L + 3*mm, y - 4.7*mm, txt + ("…" if txt != str(desc) else ""))
        c.setFont("Helvetica-Bold", FS_BODY)
        c.drawRightString(R - 3*mm, y - 4.7*mm, str(cant))
        c.setStrokeColor(RULE); c.setLineWidth(0.3); c.line(L, y - 7*mm, R, y - 7*mm)
        y -= 7 * mm
    y -= 8 * mm
    if data.get("obs"):
        c.setFillColor(MUTED); c.setFont("Helvetica", FS_LABEL); c.drawString(L, y, "NOTAS")
        c.setFillColor(MID); c.setFont("Helvetica", FS_BODY); c.drawString(L + 18*mm, y, str(data["obs"])); y -= 6 * mm
    # Firmas + footer
    c.setFillColor(MUTED); c.setFont("Helvetica", FS_LABEL)
    c.drawString(L, 24*mm, "Preparado por: __________________")
    c.drawString(L + CW*0.55, 24*mm, "Recibido: __________________")
    c.setStrokeColor(RULE); c.setLineWidth(0.6); c.line(L, 16*mm, R, 16*mm)
    c.drawString(L, 12*mm, "pisospacific.com")
    c.drawRightString(R, 12*mm, data.get("fecha", ""))
    c.showPage(); c.save()
    return buf.getvalue()


def generate_pdf(data: dict) -> bytes:
    """
    Genera el presupuesto y devuelve los bytes del PDF.
    Ver docstring del módulo para la estructura completa de `data`.
    """
    if data.get("doc_type") == "remito":
        return _remito(data)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)

    # Estilo / plantilla
    S = STYLES.get(data.get("template", "clasico"), STYLES["clasico"])
    ACCENT = S["accent"] or INK          # color de acento (títulos de zona, subtotales)
    TOTAL_MODE = S["total"]              # flat | accent | dark

    # ── LOGO ────────────────────────────────────────────────────────
    # Ratio original del logo PNG aprobado: 1022 × 306 px = 3.34 : 1
    logo_w = 58 * mm
    logo_h = logo_w / (1022 / 306)
    c.drawImage(LOGO_PATH, L, H - 8*mm - logo_h,
                width=logo_w, height=logo_h, mask="auto")

    # Fecha alineada a la derecha (el vendedor va en la banda de datos, sin duplicar)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", FS_BODY)
    c.drawRightString(R, H - 13*mm, data["fecha"])

    # Línea divisoria bajo el header
    c.setStrokeColor(RULE)
    c.setLineWidth(0.8)
    c.line(L, H - 8*mm - logo_h - 3*mm, R, H - 8*mm - logo_h - 3*mm)

    y = H - 8*mm - logo_h - 9*mm

    # ── ENCABEZADO TIPO PROPUESTA ───────────────────────────────────
    # Eyebrow + obra como título grande (se siente hecho a medida, no un recibo).
    c.setFillColor(MUTED)
    c.setFont("Helvetica", FS_LABEL)
    c._charSpace = 2
    c.drawString(L, y, "PRESUPUESTO")
    c._charSpace = 0

    # Badge de vigencia, alineado a la derecha del eyebrow
    vig = int(data.get("vigencia_dias", 10) or 10)
    badge_txt = f"VÁLIDO {vig} DÍAS"
    c.setFont("Helvetica-Bold", FS_LABEL)
    tw = c.stringWidth(badge_txt, "Helvetica-Bold", FS_LABEL)
    bw, bh = tw + 7*mm, 5.2*mm
    c.setStrokeColor(ACCENT); c.setLineWidth(0.8)
    c.roundRect(R - bw, y - 1.4*mm, bw, bh, 1.2*mm, fill=0, stroke=1)
    c.setFillColor(ACCENT)
    c._charSpace = 0.5
    c.drawCentredString(R - bw/2, y + 0.4*mm, badge_txt)
    c._charSpace = 0

    y -= 8 * mm
    obra_title = data.get("obra") or data["cliente"]
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 18)
    c.drawString(L, y, obra_title)
    y -= 9 * mm

    # ── DATOS CLIENTE / VENDEDOR (la obra ya es el título) ──────────
    col_w = CW / 3
    for i, (label, val) in enumerate([
        ("CLIENTE",  data["cliente"]),
        ("VENDEDOR", data["vendedor_short"]),
    ]):
        x = L + i * col_w
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c._charSpace = 1.5
        c.drawString(x, y, label)
        c._charSpace = 0
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", FS_BODY)
        c.drawString(x, y - 5.5*mm, val)

    y -= 11 * mm

    # ── RESUMEN DEL PROYECTO ────────────────────────────────────────
    res = data.get("resumen") or {}
    parts = []
    if res.get("m2"):        parts.append(f"{res['m2']} m²")
    if res.get("ambientes"): parts.append(f"{res['ambientes']} ambiente" + ("s" if res['ambientes'] != 1 else ""))
    if res.get("items"):     parts.append(f"{res['items']} ítems")
    if parts:
        c.setStrokeColor(RULE); c.setLineWidth(0.4)
        c.line(L, y + 3*mm, R, y + 3*mm)
        c.setFillColor(MID)
        c.setFont("Helvetica", FS_BODY)
        c.drawString(L, y - 1.5*mm, "   ·   ".join(parts))
        y -= 4 * mm

    if data.get("obs"):
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c.drawString(L, y, "Obs.")
        c.setFillColor(MID)
        c.setFont("Helvetica", FS_BODY)
        c.drawString(L + 10*mm, y, data["obs"])
        y -= 5 * mm

    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(L, y - 3*mm, R, y - 3*mm)
    y -= 8 * mm

    # ── FUNCIONES INTERNAS ──────────────────────────────────────────

    def draw_col_header():
        nonlocal y
        c.setFillColor(BGCOL)
        c.rect(L, y - 5.5*mm, CW, 5.5*mm, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c._charSpace = 1
        c.drawString(L + 3*mm,          y - 3.6*mm, "DESCRIPCION")
        c.drawRightString(L + CW*0.60,  y - 3.6*mm, "CANT / UND")
        c.drawRightString(L + CW*0.77,  y - 3.6*mm, "P. UNIT.")
        c.drawRightString(R - 1*mm,     y - 3.6*mm, "TOTAL")
        c._charSpace = 0
        y -= 5.5 * mm

    def draw_rows(rows):
        nonlocal y
        for row in rows:
            c.setFillColor(WHITE)
            c.rect(L, y - 6.5*mm, CW, 6.5*mm, fill=1, stroke=0)
            # descripción
            c.setFillColor(INK)
            c.setFont("Helvetica", FS_BODY)
            c.drawString(L + 3*mm, y - 4.3*mm, row[0])
            # cantidad / precio unit / total
            c.setFillColor(MID)
            c.setFont("Helvetica", FS_BODY)
            c.drawRightString(L + CW*0.60, y - 4.3*mm, str(row[1]) if row[1] else "—")
            c.drawRightString(L + CW*0.77, y - 4.3*mm, row[2] if row[2] else "—")
            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", FS_BODY)
            c.drawRightString(R - 1*mm, y - 4.3*mm, row[3])
            # línea inferior sutil
            c.setStrokeColor(RULE)
            c.setLineWidth(0.3)
            c.line(L, y - 6.5*mm, R, y - 6.5*mm)
            y -= 6.5 * mm

    def draw_subtotal(label: str, val: str):
        """Subtotal de sección — número prominente (13pt)."""
        nonlocal y
        ROW_H = 9 * mm
        c.setFillColor(BGCOL)
        c.rect(L, y - ROW_H, CW, ROW_H, fill=1, stroke=0)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c._charSpace = 1.5
        c.drawString(L + 3*mm, y - 5.8*mm, label.upper())
        c._charSpace = 0
        c.setFillColor(ACCENT)
        c.setFont("Helvetica-Bold", FS_SUB)
        c.drawRightString(R - 1*mm, y - 6.2*mm, val)
        y -= ROW_H + 6*mm

    def draw_section_title(title: str):
        """Título de zona: línea vertical izquierda + texto en mayúsculas."""
        nonlocal y
        c.setStrokeColor(ACCENT)
        c.setLineWidth(1.8)
        c.line(L, y, L, y - 6*mm)
        c.setLineWidth(0.5)
        c.setFillColor(ACCENT)
        c.setFont("Helvetica-Bold", FS_TITLE)
        c._charSpace = 1.5
        c.drawString(L + 4*mm, y - 4.2*mm, title.upper())
        c._charSpace = 0
        y -= 7 * mm

    # ── CONTENIDO ───────────────────────────────────────────────────
    if data["mode"] == "sections":
        for sec in data["sections"]:
            draw_section_title(sec["title"])
            draw_col_header()
            draw_rows(sec["rows"])
            draw_subtotal(sec["subtotal_label"], sec["subtotal_val"])
    else:
        draw_col_header()
        draw_rows(data["rows"])

    # ── BLOQUE DE TOTALES ────────────────────────────────────────────
    # Separación clara respecto del listado de productos.
    y -= 8 * mm if data["mode"] == "single" else 4 * mm

    # Subtotal general — grande en ambos modos
    lbl = "SUBTOTAL" if data["mode"] == "single" else "SUBTOTAL GENERAL"
    c.setFillColor(BGCOL)
    c.rect(L, y - 9*mm, CW, 9*mm, fill=1, stroke=0)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", FS_LABEL)
    c._charSpace = 1.5
    c.drawString(L + 3*mm, y - 5.8*mm, lbl)
    c._charSpace = 0
    c.setFillColor(ACCENT)
    c.setFont("Helvetica-Bold", FS_SUB)
    c.drawRightString(R - 1*mm, y - 6.2*mm, data["subtotal"])
    y -= 9*mm + 4*mm

    # IVA — discreto
    c.setStrokeColor(RULE)
    c.setLineWidth(0.3)
    c.line(L + CW*0.55, y, R, y)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", FS_LABEL)
    c.drawRightString(L + CW*0.78, y - 4*mm, "IVA 21%")
    c.drawRightString(R - 1*mm,    y - 4*mm, data["iva"])
    y -= 6 * mm

    # Total con IVA — según plantilla
    if TOTAL_MODE in ("accent", "dark"):
        # Banda llena prominente: el cliente fija la mirada en el valor.
        band_h = 12 * mm
        fill = ACCENT if TOTAL_MODE == "accent" else INK
        c.setFillColor(fill)
        c.rect(L, y - band_h, CW, band_h, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("Helvetica", FS_LABEL)
        c._charSpace = 2
        c.drawString(L + 3*mm, y - 7.6*mm, "TOTAL C/IVA")
        c._charSpace = 0
        c.setFont("Helvetica-Bold", 14)
        c.drawRightString(R - 3*mm, y - 8*mm, data["total"])
        y -= band_h + 2*mm
    else:
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        c.line(L + CW*0.45, y, R, y)
        y -= 2 * mm
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c._charSpace = 2
        c.drawRightString(L + CW*0.78, y - 4.5*mm, "TOTAL C/IVA")
        c._charSpace = 0
        c.setFillColor(INK)
        c.setFont("Helvetica-Bold", FS_TOTAL)
        c.drawRightString(R - 1*mm, y - 5*mm, data["total"])
        y -= 12 * mm

    # ── CONDICIONES COMERCIALES ──────────────────────────────────────
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(L, y, R, y)
    y -= 5 * mm

    for key, val in [
        ("Forma de pago", "Anticipo 80%  ·  Conforme 20%"),
        ("Valores",       "Dolares billete promedio dos puntas"),
        ("Vigencia",      "10 dias corridos desde la fecha de emision"),
        ("Garantia",      "Valida si la instalacion es realizada por Pisos Pacific"),
    ]:
        c.setFillColor(MUTED)
        c.setFont("Helvetica", FS_LABEL)
        c.drawString(L, y, key)
        c.setFillColor(MID)
        c.setFont("Helvetica", FS_LABEL)
        c.drawString(L + 28*mm, y, val)
        y -= 4.5 * mm

    # ── FOOTER ──────────────────────────────────────────────────────
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(L, 13*mm, R, 13*mm)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", FS_LABEL)
    c.drawString(L,       9*mm, "pisospacific.com")
    c.drawCentredString(W/2, 9*mm, data["vendedor"])
    c.drawRightString(R,  9*mm, data["fecha"])

    c.save()
    buf.seek(0)
    return buf.read()


# ── EJEMPLO DE USO DIRECTO ───────────────────────────────────────────
if __name__ == "__main__":
    # Ejemplo 1: modo sections (por zonas)
    example_sections = {
        "fecha":          "19/05/2026",
        "vendedor":       "Juan Rodriguez Momesso · 15 5175 0087",
        "vendedor_short": "Juan Rodriguez Momesso",
        "cliente":        "Arq. Agustina Bilbao",
        "obra":           "Village Golf",
        "obs":            "Colocacion s/ piso nivelado. Demasia 10% incluida. Incluye escalera.",
        "mode":           "sections",
        "sections": [
            {
                "title": "Planta Baja",
                "rows": [
                    ("H2OHD XL - Roble Eslavonia 6,5mm x 23cm x 1,50m", "51,7 m2", "US$ 38,00", "US$ 1.964,60"),
                    ("Servicio - Colocacion H2O",                        "47 m2",   "US$ 15,00", "US$   705,00"),
                    ("Servicio de Entrega",                               "—",       "—",         "US$   230,00"),
                    ("Nylon Manta 200 Micrones",                         "47 m2",   "US$  0,00", "Bonificado"),
                ],
                "subtotal_label": "Subtotal Planta Baja",
                "subtotal_val":   "US$ 2.899,60",
            },
            {
                "title": "Planta Alta",
                "rows": [
                    ("H2OHD XL - Roble Eslavonia 6,5mm x 23cm x 1,50m", "100,1 m2", "US$ 38,00", "US$ 3.803,80"),
                    ("Servicio - Colocacion H2O",                        "91 m2",    "US$ 15,00", "US$ 1.365,00"),
                    ("Nylon Manta 200 Micrones",                         "91 m2",    "US$  0,00", "Bonificado"),
                ],
                "subtotal_label": "Subtotal Planta Alta",
                "subtotal_val":   "US$ 5.168,80",
            },
            {
                "title": "Escaleras",
                "rows": [
                    ("H2OHD XL - Roble Eslavonia 6,5mm x 23cm x 1,50m", "15 m2",  "US$ 38,00", "US$   570,00"),
                    ("Colocacion y Ajustes Compensados / Descansos",     "5 un.",  "US$ 95,33", "US$   476,65"),
                    ("Pegamento especial para escalera",                 "7 un.",  "US$ 28,00", "US$   196,00"),
                    ("Colocacion Pedada / Frentin (Linea H2O)",          "12 un.", "US$ 47,67", "US$   572,04"),
                ],
                "subtotal_label": "Subtotal Escaleras",
                "subtotal_val":   "US$ 1.814,69",
            },
        ],
        "subtotal": "US$  9.883,09",
        "iva":      "US$  2.075,45",
        "total":    "US$ 11.958,54",
    }

    # Ejemplo 2: modo single (todo junto)
    example_single = {
        "fecha":          "30/03/2026",
        "vendedor":       "Juan Rodriguez Momesso · 15 5175 0087",
        "vendedor_short": "Juan Rodriguez Momesso",
        "cliente":        "Florencia Daneri",
        "obra":           "Santa Barbara",
        "obs":            "Colocacion s/ carpeta limpia, seca y nivelada. Medidas a verificar en obra.",
        "mode":           "single",
        "rows": [
            ("H2OHD XL - Natural Oak 6,5mm x 23cm x 1,50m", "120 m2", "US$ 38,00", "US$ 4.560,00"),
            ("Servicio - Colocacion H2O",                   "120 m2", "US$ 15,00", "US$ 1.800,00"),
            ("Servicio de Entrega",                          "—",      "—",         "US$   250,00"),
        ],
        "subtotal": "US$ 6.610,00",
        "iva":      "US$ 1.388,10",
        "total":    "US$ 7.998,10",
    }

    with open("presupuesto_sections.pdf", "wb") as f:
        f.write(generate_pdf(example_sections))
    with open("presupuesto_single.pdf", "wb") as f:
        f.write(generate_pdf(example_single))
    print("PDFs generados: presupuesto_sections.pdf / presupuesto_single.pdf")
