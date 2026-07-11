// Bot de TAREAS por WhatsApp para el equipo (misma allowlist que el bot de gastos).
// El vendedor le escribe al número del negocio en lenguaje natural — "llevar muestras a
// García el jueves" — y queda registrada como task (type 'todo', solo visible en la vista
// Lista de la Agenda). "pendientes" lista las suyas; "listo 2" / "ya llevé las muestras"
// completa; "borrar" deshace la última. El parsing lo hace Claude (REST, sin SDK — misma
// convención que el resto de integrations/); sin ANTHROPIC_API_KEY degrada a un parser
// simple de fechas y sigue andando.
import { withTimeout } from './http.mjs';
import { normalizePhone } from '../import/cash-parse.mjs';

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const aiOk = () => !!process.env.ANTHROPIC_API_KEY;

// ---------- fechas (todo en hora ARGENTINA — el server corre en UTC) ----------
const ART_TZ = 'America/Argentina/Buenos_Aires';
export function todayArt() {
  return new Date().toLocaleDateString('en-CA', { timeZone: ART_TZ });   // YYYY-MM-DD
}
function artWeekday() {
  return new Date().toLocaleDateString('es-AR', { timeZone: ART_TZ, weekday: 'long' });
}
function fmtDue(ymd) {
  const today = todayArt();
  if (!ymd || ymd === today) return 'hoy';
  const d = new Date(ymd + 'T12:00:00');
  const tomorrow = new Date(today + 'T12:00:00'); tomorrow.setDate(tomorrow.getDate() + 1);
  if (ymd === tomorrow.toISOString().slice(0, 10)) return 'mañana';
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' });
}

// Fallback sin IA: "hoy", "mañana", "pasado mañana", día de semana ("el jueves"), "15/7".
// Una sola regex por patrón (tolerante a acentos), que sirve para DETECTAR y para SACAR la
// fecha del título — así no hay dos representaciones que mantener sincronizadas.
const RELATIVE = [
  [/\bpasado\s+ma[ñn]ana\b/i, 2],
  [/\bma[ñn]ana\b/i, 1],
  [/\bhoy\b/i, 0],
];
const WEEKDAY_RX = [/\b(el\s+)?domingo\b/i, /\b(el\s+)?lunes\b/i, /\b(el\s+)?martes\b/i, /\b(el\s+)?mi[eé]rcoles\b/i, /\b(el\s+)?jueves\b/i, /\b(el\s+)?viernes\b/i, /\b(el\s+)?s[aá]bado\b/i];
export function parseDueDateSimple(text) {
  const t = String(text || '');
  const today = new Date(todayArt() + 'T12:00:00');
  const ymd = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  for (const [rx, days] of RELATIVE) if (rx.test(t)) return { date: ymd(plus(days)), match: rx };
  const dm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : today.getFullYear();
    const d = new Date(year, +dm[2] - 1, +dm[1], 12);
    if (!isNaN(+d)) { if (!dm[3] && d < today) d.setFullYear(d.getFullYear() + 1); return { date: ymd(d), match: new RegExp(dm[0]) }; }
  }
  for (let i = 0; i < 7; i++) {
    if (WEEKDAY_RX[i].test(t)) {
      const diff = ((i - today.getDay() + 7) % 7) || 7;   // próximo, no hoy
      return { date: ymd(plus(diff)), match: WEEKDAY_RX[i] };
    }
  }
  return null;
}

// ---------- helpers de datos ----------
function matchSeller(db, from) {
  const norm = normalizePhone(from);
  const s = (db.settings?.sellers || []).find((x) => normalizePhone(x.phone) === norm);
  return s?.name || null;
}
// Pendientes 'todo' del vendedor (o cargadas desde ese teléfono si no es seller conocido),
// ordenadas: vencidas → hoy → futuras.
export function pendingTodos(db, sellerName, phoneNorm) {
  return (db.tasks || [])
    .filter((t) => t.type === 'todo' && t.status === 'pendiente' &&
      (sellerName ? t.assigned_seller === sellerName : t.created_by === phoneNorm))
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '') || (a.created_at || '').localeCompare(b.created_at || ''));
}
function renderList(tasks) {
  const today = todayArt();
  return tasks.map((t, i) => {
    const overdue = t.due_date && t.due_date < today;
    return `${i + 1}) ${t.title} · ${fmtDue(t.due_date)}${overdue ? ' ⚠️' : ''}`;
  }).join('\n');
}
const HELP = 'Soy el asistente de tareas de Pacific 📋\n· Escribime la tarea y cuándo: *llevar muestras a García el jueves*\n· *pendientes* → tu lista\n· *listo 2* (o contame qué terminaste) → la completa\n· *borrar* → deshace la última cargada\n(Los gastos en efectivo siguen igual: *gasto 5000 ferretería*)';

// ---------- LLM: entender el mensaje ----------
async function understand(text, { sellerName, pending }) {
  const pendingTxt = pending.length
    ? pending.map((t) => `- id:${t.id} · ${t.title} · vence ${t.due_date || 'sin fecha'}`).join('\n')
    : '(no tiene tareas pendientes)';
  const system = `Sos el asistente de tareas del equipo de ventas de Pisos Pacific (Argentina). Analizá el mensaje de WhatsApp de un vendedor y devolvé SOLO un JSON (sin markdown, sin explicación) con esta forma exacta:
{"intent":"create"|"complete"|"list"|"expense"|"other","title":string|null,"due_date":string|null,"complete_task_id":string|null}
Reglas:
- "create": el mensaje describe algo para hacer o recordar (visita técnica, llevar muestras, llamar a alguien, mandar presupuesto, etc.). "title" = la tarea resumida en imperativo corto, SIN la fecha (ej: "Llevar muestras a García"). "due_date" = la fecha resuelta en YYYY-MM-DD (hoy es ${todayArt()}, ${artWeekday()}; "el jueves" = el próximo jueves); si no menciona cuándo → null.
- "complete": dice que ya hizo/terminó algo → "complete_task_id" = el id de la tarea pendiente que mejor coincide (lista abajo). Si ninguna coincide claramente → intent "other".
- "list": pide ver sus tareas/pendientes.
- "expense": está reportando plata gastada en efectivo (ej "gasto 5000 ferretería", "pagué 20 lucas el flete").
- "other": saludo, pregunta u otra cosa.
Tareas pendientes de ${sellerName || 'este vendedor'}:
${pendingTxt}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', withTimeout({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 300, system, messages: [{ role: 'user', content: text }] }),
  }, 25000));
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`IA ${r.status}: ${t.slice(0, 150)}`); }
  const j = await r.json();
  const raw = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('IA sin JSON');
  return JSON.parse(m[0]);
}

// ---------- crear / completar ----------
function createTask(db, save, { title, due, sellerName, phoneNorm }) {
  const t = {
    id: `task-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: 'todo',
    title,
    due_date: due || todayArt(),
    assigned_seller: sellerName || undefined,
    status: 'pendiente',
    created_at: new Date().toISOString(),
    created_by: phoneNorm,
    source: 'wa-task-bot',
  };
  db.tasks = db.tasks || [];
  db.tasks.push(t);
  const sessions = db.settings.task_sessions = db.settings.task_sessions || {};
  sessions[phoneNorm] = { ...(sessions[phoneNorm] || {}), last_created: t.id };
  save();
  return t;
}
function completeTask(db, save, t) {
  t.status = 'completada';
  t.completed_at = new Date().toISOString();
  save();
}

// ---------- handler principal ----------
// reply(msg) la inyecta meta.mjs (evita import circular); handleExpense() deriva al bot de gastos.
export async function handleTaskMessage(db, save, from, rawText, { reply, handleExpense }) {
  db.settings = db.settings || {};
  const phoneNorm = normalizePhone(from);
  const sellerName = matchSeller(db, from);
  const text = String(rawText || '').trim();
  if (!text) return reply(HELP);

  const sessions = db.settings.task_sessions = db.settings.task_sessions || {};
  const listPending = () => {
    const pending = pendingTodos(db, sellerName, phoneNorm);
    if (!pending.length) return reply('No tenés tareas pendientes ✨');
    sessions[phoneNorm] = { ...(sessions[phoneNorm] || {}), ids: pending.map((t) => t.id) };
    save();
    return reply(`Tenés ${pending.length} pendiente${pending.length === 1 ? '' : 's'}:\n${renderList(pending)}\n\nCompletá con *listo N*.`);
  };

  // Atajos deterministas (sin IA)
  if (/^(ayuda|help)\b/i.test(text)) return reply(HELP);
  if (/^pendientes?$/i.test(text)) return listPending();
  const done = text.match(/^(listo|hecho)\s*(\d+)$/i);
  if (done) {
    const ids = sessions[phoneNorm]?.ids || [];
    const t = (db.tasks || []).find((x) => x.id === ids[+done[2] - 1] && x.status === 'pendiente');
    if (!t) return reply('No encontré esa tarea — mandá *pendientes* para ver la lista numerada y después *listo N*.');
    completeTask(db, save, t);
    return reply(`✔️ Completada: ${t.title}`);
  }
  if (/^borrar$/i.test(text)) {
    const id = sessions[phoneNorm]?.last_created;
    const i = (db.tasks || []).findIndex((x) => x.id === id);
    if (i < 0) return reply('No tengo una tarea recién cargada para borrar.');
    const [t] = db.tasks.splice(i, 1);
    delete sessions[phoneNorm].last_created;
    save();
    return reply(`🗑️ Borrada: ${t.title}`);
  }

  const confirmCreate = (t) =>
    reply(`✅ Anotado: ${t.title}\n📅 ${fmtDue(t.due_date)}${sellerName ? '' : ' · (no reconozco tu número como vendedor — igual la guardé)'}\n(*pendientes* para ver tu lista · *borrar* si no era una tarea)`);

  // Camino con IA: entiende contexto libre (crear / completar por descripción / gasto / otro).
  if (aiOk()) {
    try {
      const pending = pendingTodos(db, sellerName, phoneNorm);
      const out = await understand(text, { sellerName, pending });
      if (out.intent === 'expense') return handleExpense();
      if (out.intent === 'list') return listPending();
      if (out.intent === 'complete' && out.complete_task_id) {
        const t = pending.find((x) => x.id === out.complete_task_id);
        if (t) { completeTask(db, save, t); return reply(`✔️ Completada: ${t.title}`); }
      }
      if (out.intent === 'create' && out.title) {
        // Solo aceptar la fecha de la IA si es YYYY-MM-DD válido (otra cosa → default hoy).
        const due = /^\d{4}-\d{2}-\d{2}$/.test(out.due_date || '') ? out.due_date : null;
        return confirmCreate(createTask(db, save, { title: out.title, due, sellerName, phoneNorm }));
      }
      return reply(HELP);
    } catch (e) {
      console.warn('[task-bot] IA falló, uso parser simple:', e.message);
    }
  }

  // Fallback sin IA (o si la IA falló): el mensaje es la tarea; fecha por regex.
  const parsed = parseDueDateSimple(text);
  const title = (parsed ? text.replace(parsed.match, '') : text)
    .replace(/^\s*tarea[:\s]*/i, '').replace(/\s{2,}/g, ' ').replace(/[\s,·-]+$/g, '').trim();
  if (!title) return reply(HELP);
  return confirmCreate(createTask(db, save, { title, due: parsed?.date, sellerName, phoneNorm }));
}

// ---------- resumen diario (lo dispara el scheduler de server.js) ----------
// Devuelve el texto del digest del vendedor, o null si no tiene nada (→ no se le manda).
// Si viene `phone`, guarda el mapeo N→task en la sesión para que "listo N" responda AL digest
// directamente (sin tener que pedir "pendientes" primero).
export function buildDailyDigest(db, sellerName, phone) {
  const today = todayArt();
  const todos = (db.tasks || []).filter((t) =>
    t.type === 'todo' && t.status === 'pendiente' && t.assigned_seller === sellerName && (t.due_date || today) <= today);
  const agenda = (db.tasks || []).filter((t) =>
    t.type !== 'todo' && t.status === 'pendiente' && t.assigned_seller === sellerName && t.due_date === today);
  if (!todos.length && !agenda.length) return null;
  if (phone) {
    const norm = normalizePhone(phone);
    const sessions = db.settings.task_sessions = db.settings.task_sessions || {};
    sessions[norm] = { ...(sessions[norm] || {}), ids: todos.map((t) => t.id) };
  }
  let msg = `☀️ Buen día! Pendientes de hoy:`;
  if (todos.length) msg += `\n${renderList(todos)}`;
  if (agenda.length) msg += `\n\nAdemás en tu agenda:\n${agenda.map((t) => `· ${t.title}`).join('\n')}`;
  msg += `\n\nCompletá con *listo N* o contame qué terminaste.`;
  return msg;
}
