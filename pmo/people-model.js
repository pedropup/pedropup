// Regras da tela "Pendencias por responsavel". Funcoes puras sobre as tarefas que a API /tasks devolve:
// nada aqui toca DOM nem rede, para poder ser testado com `node --test`.
// Datas sao civis (AAAA-MM-DD); "hoje" vem de todayKey() da ui.js (fuso de Sao Paulo).

export const SOON_DAYS = 7; // "vence logo" = prazo nos proximos 7 dias corridos
export const STALE_DAYS = 7; // "parada" = sem atualizacao ha 7 dias ou mais
export const NO_OWNER = 'none';

const BLOCKED = new Set(['bloqueado', 'aguardando_terceiro']);
const PROGRESS = new Set(['em_andamento', 'em_validacao']);
const TODO = new Set(['planejado', 'nao_iniciado', 'backlog']);
const PRIO = { critica: 0, alta: 1, media: 2, baixa: 3 };

function dayNum(iso) { return Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') / 86400000; }

/** Dias corridos de `from` ate `to` (positivo se `to` vem depois). */
export function daysBetween(from, to) { return Math.round(dayNum(to) - dayNum(from)); }

export function ownerKey(t) { return t.assignee_id == null ? NO_OWNER : String(t.assignee_id); }

export function isOverdue(t, today) {
  if (typeof t.is_overdue === 'boolean') return t.is_overdue; // o servidor decide quando informa
  return Boolean(t.due_date) && daysBetween(today, t.due_date) < 0;
}
export const isBlocked = (t) => BLOCKED.has(t.status);
export function isDueSoon(t, today) {
  if (!t.due_date || isOverdue(t, today)) return false;
  const d = daysBetween(today, t.due_date);
  return d >= 0 && d <= SOON_DAYS;
}
export const isCritical = (t) => t.priority === 'critica' || t.priority === 'alta';
export const isSlaBad = (t) => ['vencido', 'em_risco', 'violado'].includes(t.sla?.state);
export function staleDays(t, today) { return t.updated_at ? Math.max(0, daysBetween(t.updated_at, today)) : null; }

/** Grupo de urgencia de uma tarefa aberta, do mais urgente para o menos. Cada tarefa cai em um so. */
export const GROUPS = [
  ['overdue', 'Atrasadas', 'red'],
  ['blocked', 'Bloqueadas ou aguardando terceiro', 'amber'],
  ['soon', `Vencem nos próximos ${SOON_DAYS} dias`, 'amber'],
  ['progress', 'Em andamento e em validação', 'blue'],
  ['todo', 'A iniciar (planejado, não iniciado, backlog)', ''],
  ['other', 'Outras abertas', ''],
];
export function groupOf(t, today) {
  if (isOverdue(t, today)) return 'overdue';
  if (isBlocked(t)) return 'blocked';
  if (isDueSoon(t, today)) return 'soon';
  if (PROGRESS.has(t.status)) return 'progress';
  if (TODO.has(t.status)) return 'todo';
  return 'other';
}

/** Ordem dentro do grupo: prazo mais antigo primeiro (sem prazo no fim), depois prioridade, depois codigo. */
export function byUrgency(a, b) {
  return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31')
    || (PRIO[a.priority] ?? 4) - (PRIO[b.priority] ?? 4)
    || String(a.code).localeCompare(String(b.code), 'pt-BR', { numeric: true });
}

export function groupTasks(tasks, today) {
  const out = Object.fromEntries(GROUPS.map(([k]) => [k, []]));
  for (const t of tasks) out[groupOf(t, today)].push(t);
  for (const k of Object.keys(out)) out[k].sort(byUrgency);
  return out;
}

/** Numeros do topo para um conjunto de tarefas abertas. */
export function summarize(tasks, today) {
  const late = tasks.filter((t) => isOverdue(t, today) && t.due_date).map((t) => -daysBetween(today, t.due_date));
  const oldest = tasks.reduce((m, t) => (t.created_at && (!m || t.created_at < m.created_at) ? t : m), null);
  return {
    open: tasks.length,
    overdue: tasks.filter((t) => isOverdue(t, today)).length,
    maxLate: late.length ? Math.max(...late) : 0,
    blocked: tasks.filter(isBlocked).length,
    soon: tasks.filter((t) => isDueSoon(t, today)).length,
    inProgress: tasks.filter((t) => PROGRESS.has(t.status)).length,
    critical: tasks.filter(isCritical).length,
    slaBad: tasks.filter(isSlaBad).length,
    noDue: tasks.filter((t) => !t.due_date).length,
    stale: tasks.filter((t) => (staleDays(t, today) ?? 0) >= STALE_DAYS).length,
    oldestDays: oldest ? daysBetween(oldest.created_at, today) : null,
  };
}

/**
 * Carga de cada responsavel (pessoas do meta + "Sem responsavel"), mais atrasado primeiro.
 * Inclui quem tem zero tarefas abertas, para o filtro listar todo mundo.
 */
export function workload(tasks, people, today) {
  const by = new Map();
  for (const t of tasks) { const k = ownerKey(t); if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
  const rows = people.map((p) => ({ key: String(p.id), name: p.name, ...summarize(by.get(String(p.id)) || [], today) }));
  // tarefa atribuida a alguem que nao esta em `people` (pessoa inativa): aparece com o nome da propria tarefa
  for (const [k, list] of by) {
    if (k === NO_OWNER || rows.some((r) => r.key === k)) continue;
    rows.push({ key: k, name: list[0].assignee_name || `Pessoa ${k}`, ...summarize(list, today) });
  }
  if (by.has(NO_OWNER)) rows.push({ key: NO_OWNER, name: 'Sem responsável', ...summarize(by.get(NO_OWNER), today) });
  return rows.sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name, 'pt-BR'));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const dias = (n) => plural(n, 'dia', 'dias');

/** Texto do prazo em linguagem direta, com o tom (red/amber/'') para a cor. */
export function dueText(t, today) {
  if (!t.due_date) return { text: 'sem prazo', tone: '' };
  const d = daysBetween(today, t.due_date);
  const kind = t.due_kind === 'acordado' ? 'acordado' : 'sugerido';
  const [y, m, dd] = t.due_date.slice(0, 10).split('-');
  const date = `${dd}/${m}/${y}`;
  if (isOverdue(t, today) && d < 0) return { text: `atrasada há ${dias(-d)} (prazo ${kind} ${date})`, tone: 'red' };
  if (d === 0) return { text: `vence hoje (prazo ${kind})`, tone: 'amber' };
  if (d === 1) return { text: `vence amanhã (prazo ${kind})`, tone: 'amber' };
  if (d <= SOON_DAYS) return { text: `vence em ${dias(d)} (prazo ${kind} ${date})`, tone: 'amber' };
  return { text: `prazo ${kind} ${date}`, tone: '' };
}

/** Escolhe quem mostrar ao abrir: o pedido na URL, senao a propria pessoa do usuario, senao a mais atrasada. */
export function pickPerson(rows, requested, mine) {
  const has = (k) => k != null && rows.some((r) => r.key === String(k));
  if (has(requested)) return String(requested);
  if (has(mine)) return String(mine);
  return rows.find((r) => r.open > 0)?.key ?? rows[0]?.key ?? null;
}

// ---------- Filtros extras (area, empresa, projeto, prioridade, etapa, prazo, tag e busca) ----------
// Todos combinam (E). Valor vazio = sem filtro. Os nomes viram parametros da URL do Command Center.
export const FILTER_KEYS = ['area', 'company', 'project', 'priority', 'status', 'due', 'tag', 'q'];
export const DUE_FILTERS = {
  overdue: 'Atrasadas',
  today: 'Vencem hoje',
  week: `Vencem em até ${SOON_DAYS} dias`,
  month: 'Vencem em até 30 dias',
  later: 'Prazo depois de 30 dias',
  agreed: 'Só prazo acordado',
  none: 'Sem prazo',
};

function norm(s) { return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
function tagsOf(t) { return Array.isArray(t.tags) ? t.tags.map(String) : String(t.tags || '').split(',').map((x) => x.trim()).filter(Boolean); }

export function matchesDue(t, due, today) {
  if (!due) return true;
  if (due === 'none') return !t.due_date;
  if (!t.due_date) return false;
  if (due === 'agreed') return t.due_kind === 'acordado';
  if (due === 'overdue') return isOverdue(t, today);
  const d = daysBetween(today, t.due_date);
  if (isOverdue(t, today) || d < 0) return false;
  if (due === 'today') return d === 0;
  if (due === 'week') return d <= SOON_DAYS;
  if (due === 'month') return d <= 30;
  if (due === 'later') return d > 30;
  return true;
}

export function matchesFilters(t, f = {}, today) {
  if (f.area && t.area !== f.area) return false;
  if (f.company && t.company_slug !== f.company) return false;
  if (f.project && (t.project_name || '') !== f.project) return false;
  if (f.priority && t.priority !== f.priority) return false;
  if (f.status && t.status !== f.status) return false;
  if (f.tag && !tagsOf(t).includes(f.tag)) return false;
  if (!matchesDue(t, f.due, today)) return false;
  if (f.q) {
    const hay = norm([t.code, t.title, t.next_action, t.blockers, t.project_name, t.epic_name, t.milestone_name, t.description, ...tagsOf(t)].join(' '));
    if (!norm(f.q).trim().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const applyFilters = (tasks, f, today) => tasks.filter((t) => matchesFilters(t, f, today));
export const activeFilterCount = (f = {}) => FILTER_KEYS.filter((k) => f[k]).length;

/** Valores que existem nas tarefas, para montar as listas dos filtros (com quantas tarefas cada um tem). */
export function filterOptions(tasks) {
  const count = (get) => {
    const m = new Map();
    for (const t of tasks) for (const v of [].concat(get(t))) if (v) m.set(v, (m.get(v) || 0) + 1);
    return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR')).map(([value, n]) => ({ value, n }));
  };
  return {
    area: count((t) => t.area), company: count((t) => t.company_slug), project: count((t) => t.project_name),
    priority: count((t) => t.priority).sort((a, b) => (PRIO[a.value] ?? 9) - (PRIO[b.value] ?? 9)),
    status: count((t) => t.status), tag: count(tagsOf),
  };
}
