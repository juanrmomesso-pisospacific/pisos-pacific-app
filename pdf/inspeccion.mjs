// Protocolo de inspección de obra — ítems/grupos (mirror de dashboard-app/src/lib/inspeccion.ts).
// El PDF lo renderiza el server (pdf/render.mjs, Node), por eso los ítems se definen también acá.
export const INSPECCION_GROUPS = [
  {
    title: 'Acceso y logística',
    items: [
      { key: 'horario', label: 'Horario permitido de trabajo' },
      { key: 'seguros', label: 'Seguros (ART / RC) requeridos' },
      { key: 'residuos', label: 'Lugar para dejar residuos' },
      { key: 'muebles', label: 'Movimiento de muebles' },
    ],
  },
  {
    title: 'Contrapiso / superficie',
    items: [
      { key: 'carpeta_plana', label: 'Carpeta plana y limpia' },
      { key: 'altura_carpeta', label: 'Altura de carpeta (nivel final)' },
      { key: 'obra_humeda', label: 'Obra húmeda terminada' },
      { key: 'calefaccion', label: 'Calefacción / losa radiante' },
      { key: 'piso_existente', label: 'Piso existente (¿se remueve?)' },
    ],
  },
  {
    title: 'Terminaciones del entorno',
    items: [
      { key: 'aberturas', label: 'Aberturas instaladas' },
      { key: 'pintura', label: '2 manos de pintura terminadas' },
      { key: 'marcos', label: 'Marcos de puerta para cortar' },
      { key: 'puertas_cepillar', label: 'Puertas para cepillar' },
      { key: 'puerta_blindada', label: 'Puerta blindada' },
      { key: 'encuentros_banos', label: 'Encuentros con baños' },
    ],
  },
  {
    title: 'Terminaciones a definir',
    items: [
      { key: 'varillas', label: 'Varillas de transición' },
      { key: 'cuartacana', label: 'Cuartacaña / contrazócalos' },
    ],
  },
];
export const CHECK_LABEL = { si: 'Sí', no: 'No', na: 'N/A' };
