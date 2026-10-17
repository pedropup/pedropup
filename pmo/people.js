// Pendencias por responsavel: escolha uma pessoa e veja tudo o que esta com ela, separado por urgencia,
// com prazo, proxima acao, bloqueio, SLA, validacao e ha quanto tempo ninguem mexe. Clique abre a tarefa.
// Usa so a API que ja existe (/meta e /tasks); nenhum numero e estimado.
// Roda dentro do Command Center (ctx.embedded = true, rota command-center?person=<id>): ai o filtro tem
// "Todos", que volta para a visao do portfolio.
import { api, meta } from '../api.js';
import { h, clear, append, kpi, panel, statusBadge, prioBadge, companyDot, empty, badge, bar, todayKey, AREA_SHORT, SLA_STATE, VALIDATION } from '../ui.js';
import { onTaskChanged } from '../task-drawer.js';
import { GROUPS, NO_OWNER, STALE_DAYS, SOON_DAYS, groupTasks, ownerKey, summarize, workload, dueText, staleDays, pickPerson, dias } from './people-model.js';

export async function render(root, ctx) {
  const { scope, openTask, params, navigate, onUnmount } = ctx;
  const m = await meta();
  let person = params.person || null;
  const route = ctx.embedded ? 'command-center' : 'people';
  const goPerson = (key) => navigate(route, key ? { person: key } : {});
  const select = h('select', { 'aria-label': 'Responsável', style: { fontWeight: 600, minWidth: '240px' } });
  select.addEventListener('change', () => goPerson(select.value));
  const listLink = h('a', { class: 'btn' }, 'Abrir na lista de tarefas');
  const head = h('div', { class: 'page-head' },
    ctx.embedded
      ? h('div', {}, h('h1', {}, 'Command Center'), h('p', {}, 'Filtrado por responsável: tudo o que está com a pessoa, do mais urgente para o menos. Escolha "Todos" no filtro para voltar à visão do portfólio. Os números vêm das tarefas registradas, nada é estimado.'))
      : h('div', {}, h('h1', {}, 'Pendências por responsável'), h('p', {}, 'Escolha uma pessoa e veja tudo o que está com ela, do mais urgente para o menos. Clique numa tarefa para abrir, comentar ou mudar o status. Os números vêm das tarefas registradas, nada é estimado.')),
    h('div', { class: 'actions' }, listLink));
  const bodyEl = h('div');
  root.append(head, h('div', { class: 'filters' }, h('b', { style: { fontSize: '13px' } }, 'Responsável'), select), bodyEl);

  async function load() {
    const today = todayKey();
    const r = await api.get(`/tasks${api.qs({ open: '1', company: scope })}`);
    const tasks = r.tasks;
    const rows = workload(tasks, m.people.filter((p) => p.active !== false), today);
    person = pickPerson(rows, person, m.user.person_id);
    append(clear(select), [ctx.embedded ? h('option', { value: '' }, 'Todos (visão do portfólio)') : null, rows.map((w) => h('option', { value: w.key, selected: w.key === person ? true : null },
      `${w.name} · ${w.open} ${w.open === 1 ? 'aberta' : 'abertas'}${w.overdue ? `, ${w.overdue} ${w.overdue === 1 ? 'atrasada' : 'atrasadas'}` : ''}`))]);
    listLink.href = `#/tasks?assignee=${person ?? ''}&open=1`;
    draw(rows, tasks.filter((t) => ownerKey(t) === person), today);
  }

  function draw(rows, mine, today) {
    clear(bodyEl);
    const me = rows.find((w) => w.key === person);
    if (!me) { bodyEl.append(empty('Nenhuma pessoa cadastrada', 'Cadastre pessoas em Administração > Pessoas.')); return; }
    const s = summarize(mine, today);

    // Quem e e o resumo em uma frase
    const resumo = [`${s.open} ${s.open === 1 ? 'pendência aberta' : 'pendências abertas'}`];
    if (s.overdue) resumo.push(`${s.overdue} ${s.overdue === 1 ? 'atrasada' : 'atrasadas'} (maior atraso: ${dias(s.maxLate)})`);
    if (s.oldestDays != null) resumo.push(`a mais antiga foi aberta há ${dias(s.oldestDays)}`);
    bodyEl.append(h('div', { class: 'row', style: { gap: '12px', margin: '4px 0 14px' } },
      h('div', { style: { width: '40px', height: '40px', borderRadius: '50%', background: 'var(--navy)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 650, flex: 'none' } }, initials(me.name)),
      h('div', {}, h('div', { style: { fontSize: '17px', fontWeight: 650 } }, me.name), h('div', { class: 'muted', style: { fontSize: '13px' } }, resumo.join(' · ')))));

    const jump = (k) => () => document.getElementById(`grp-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bodyEl.append(h('div', { class: 'kpis' },
      kpi(s.open, 'Abertas'),
      kpi(s.overdue, 'Atrasadas', { tone: s.overdue ? 'red' : '', sub: s.overdue ? `maior atraso: ${dias(s.maxLate)}` : null, onClick: s.overdue ? jump('overdue') : null }),
      kpi(s.blocked, 'Bloqueadas / terceiro', { tone: s.blocked ? 'amber' : '', onClick: s.blocked ? jump('blocked') : null }),
      kpi(s.soon, `Vencem em ${SOON_DAYS} dias`, { tone: s.soon ? 'amber' : '', onClick: s.soon ? jump('soon') : null }),
      kpi(s.inProgress, 'Em andamento', { tone: 'blue' }),
      kpi(s.critical, 'Críticas ou altas', { tone: s.critical ? 'red' : '' }),
      kpi(s.slaBad, 'SLA vencido ou em risco', { tone: s.slaBad ? 'red' : '' }),
      kpi(s.stale, `Paradas há ${STALE_DAYS}+ dias`, { tone: s.stale ? 'amber' : '', sub: 'sem atualização' }),
      kpi(s.noDue, 'Sem prazo', { tone: s.noDue ? 'amber' : '' }),
    ));

    if (!mine.length) bodyEl.append(empty(`${me.name} não tem pendências abertas`, 'Nada atrasado, bloqueado ou a iniciar neste escopo.'));
    const groups = groupTasks(mine, today);
    for (const [k, label, tone] of GROUPS) {
      const items = groups[k];
      if (!items.length) continue;
      const p = panel(h('span', {}, label, ' ', h('span', { class: `badge ${tone}` }, items.length)), h('ul', { class: 'list' }, items.map((t) => item(t, today))));
      p.id = `grp-${k}`;
      bodyEl.append(p);
    }

    // Carga de todos, para comparar e trocar de pessoa com um clique
    const max = Math.max(1, ...rows.map((w) => w.open));
    bodyEl.append(panel('Carga da equipe', h('ul', { class: 'list' }, rows.filter((w) => w.open > 0).map((w) => h('li', {
      class: 'clickable', onClick: () => goPerson(w.key),
      style: w.key === person ? { background: 'var(--blue-soft)' } : null,
    },
    h('div', { class: 't' },
      h('div', {}, w.key === NO_OWNER ? h('span', { class: 'badge amber' }, w.name) : w.name),
      h('div', { class: 'sub' }, [plural(w.open, 'aberta', 'abertas'), w.overdue ? plural(w.overdue, 'atrasada', 'atrasadas') : null, w.blocked ? plural(w.blocked, 'bloqueada', 'bloqueadas') : null, w.soon ? `${w.soon} vencem em ${SOON_DAYS} dias` : null].filter(Boolean).join(' · ')),
      h('div', { style: { marginTop: '4px', maxWidth: '420px' } }, bar((w.open / max) * 100, w.overdue ? 'red' : w.blocked ? 'amber' : ''))),
    w.slaBad ? h('span', { class: 'badge red' }, `${w.slaBad} SLA`) : null)))));
  }

  function item(t, today) {
    const due = dueText(t, today);
    const stale = staleDays(t, today);
    const where = [AREA_SHORT[t.area] || t.area_name, t.project_name, t.epic_name, t.milestone_name ? `marco ${t.milestone_name}` : null].filter(Boolean).join(' · ');
    const detail = (label, text, color) => h('div', { style: { fontSize: '12.5px', marginTop: '3px' } }, h('b', { style: { color: color || 'var(--ink-2)', fontWeight: 600 } }, label), ' ', text);
    // Em tela estreita as etiquetas descem para baixo do texto (flex-wrap), em vez de espremer o titulo.
    return h('li', { class: 'clickable', onClick: () => openTask(t.id), style: { flexWrap: 'wrap' } },
      companyDot(t.company_slug),
      h('div', { class: 't', style: { flex: '1 1 260px' } },
        h('div', {}, h('span', { class: 'code' }, t.code), ' ', t.kind === 'bug' ? h('span', { class: 'badge red outline', style: { marginRight: '4px' } }, 'bug') : null, t.title),
        where ? h('div', { class: 'sub' }, where) : null,
        h('div', { class: 'sub' },
          h('span', { style: due.tone ? { color: `var(--${due.tone})`, fontWeight: 600 } : null }, due.text),
          stale != null ? ` · ${stale === 0 ? 'atualizada hoje' : `sem atualização há ${dias(stale)}`}` : null,
          t.evidence_count ? ` · ${t.evidence_count} ${t.evidence_count === 1 ? 'evidência' : 'evidências'}` : ' · sem evidência',
          t.open_blockers ? ` · depende de ${t.open_blockers} ${t.open_blockers === 1 ? 'tarefa aberta' : 'tarefas abertas'}` : null),
        t.next_action ? detail('Próxima ação:', t.next_action) : null,
        t.blockers ? detail('Travada por:', t.blockers + (t.blocked_hours ? ` (${t.blocked_hours} h bloqueada)` : ''), 'var(--amber)') : null),
      h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' } },
        prioBadge(t.priority),
        t.sla?.state && !['sem_sla', 'dentro'].includes(t.sla.state) ? badge(SLA_STATE, t.sla.state) : null,
        t.validation && t.validation !== 'ok' ? badge(VALIDATION, t.validation) : null,
        statusBadge(t.status)));
  }

  onUnmount(onTaskChanged(() => load()));
  await load();
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?'; }
