// Tela 1: Command Center. Saude do portfolio, SLAs, riscos, bloqueios e prioridades.
import { api, meta } from '../api.js';
import { h, kpi, panel, ring, statusBadge, prioBadge, companyDot, fmtDate, fmtNum, fmtMoney, sparkline, empty, badge, SLA_STATE, COMPANY_SHORT, STATUS, nodata, AREA_SHORT } from '../ui.js';
import { onTaskChanged } from '../task-drawer.js';

export async function render(root, ctx) {
  const { scope, navigate, openTask } = ctx;
  // Filtro de responsavel: com uma pessoa escolhida, a tela mostra so as pendencias dela (people.js).
  if (ctx.params.person) { const view = await import('./people.js'); return view.render(root, { ...ctx, embedded: true }); }
  const m = await meta();
  const d = await api.get(`/dashboard${scope ? '?company=' + scope : ''}`);
  const ex = d.execution, g = d.governance, s = d.sla;
  const scopeName = scope ? COMPANY_SHORT[scope] : 'Grupo consolidado';
  const healthLabel = { saudavel: 'Saudável', atencao: 'Atenção', critico: 'Crítico' }[d.health.label];
  const toTasks = (params) => navigate('tasks', params);

  root.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Command Center'), h('p', {}, `${scopeName}. Situação em ${fmtDate(ex.today)}, calculada a partir dos registros do PMO. Onde não há dado, a tela diz "Sem dados".`)),
      h('div', { class: 'actions' }, personFilter(m, navigate), h('button', { class: 'btn', onClick: () => navigate('reports', { kind: 'executive' }) }, 'Relatório executivo'), h('button', { class: 'btn primary', onClick: () => navigate('kanban') }, 'Ir para o Kanban'))),
    h('div', { class: 'row', style: { marginBottom: '18px', gap: '24px' } },
      h('div', { class: 'health' }, ring(d.health.score, { label: `Saúde ${d.health.score}` }), h('div', {}, h('div', { class: 'label' }, `Saúde do portfólio: ${healthLabel}`), h('div', { class: 'reasons' }, d.health.reasons.length ? d.health.reasons.join(' · ') : 'Sem sinais de alerta nos indicadores de execução, SLA e governança.'))),
      h('div', { class: 'spacer' }),
      h('div', {}, h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Entregas por semana (8 semanas)'), sparkline(ex.weekly_deliveries.map((w) => w.delivered))),
    ),
    h('div', { class: 'kpis' },
      kpi(ex.completion_pct == null ? null : `${ex.completion_pct}%`, 'Conclusão', { sub: `${ex.concluded} de ${ex.backlog_total - ex.cancelled}` }),
      kpi(ex.backlog_total, 'Total de tarefas', { onClick: () => toTasks({}) }),
      kpi(ex.concluded, 'Concluídas', { tone: 'green', onClick: () => toTasks({ status: 'concluido' }) }),
      kpi(ex.in_progress, 'Em andamento', { tone: 'blue', onClick: () => toTasks({ status: 'em_andamento' }) }),
      kpi(ex.not_started, 'Não iniciadas', { onClick: () => toTasks({ status: 'backlog,nao_iniciado,planejado' }) }),
      kpi(ex.blocked, 'Bloqueadas', { tone: ex.blocked ? 'red' : '', onClick: () => toTasks({ status: 'bloqueado' }) }),
      kpi(ex.overdue, 'Em atraso', { tone: ex.overdue ? 'red' : '', onClick: () => toTasks({ overdue: '1' }) }),
      kpi(ex.waiting_third, 'Aguardando terceiros', { tone: ex.waiting_third ? 'amber' : '', onClick: () => toTasks({ status: 'aguardando_terceiro' }) }),
      kpi(s.breached_open, 'SLAs vencidos', { tone: s.breached_open ? 'red' : '', sub: s.at_risk ? `${s.at_risk} em risco` : null, onClick: () => navigate('sla') }),
      kpi(g.critical_risks, 'Riscos críticos', { tone: g.critical_risks ? 'red' : '', sub: `${g.open_risks} riscos abertos`, onClick: () => navigate('risks') }),
      kpi(g.pending_decisions, 'Decisões pendentes', { tone: g.overdue_decisions ? 'amber' : 'blue', sub: g.overdue_decisions ? `${g.overdue_decisions} vencidas` : null, onClick: () => navigate('risks', { tab: 'decisions' }) }),
      kpi(g.blocked_chain, 'Travadas por dependência', { tone: g.blocked_chain ? 'amber' : '', onClick: () => navigate('dependencies') }),
      kpi(g.tasks_without_owner, 'Sem responsável', { tone: g.tasks_without_owner ? 'amber' : '', onClick: () => toTasks({ no_owner: '1', open: '1' }) }),
      kpi(g.pending_validation, 'Pendentes de validação', { tone: 'violet', sub: 'fatos a confirmar', onClick: () => toTasks({ validation: 'a_verificar,pendente_evidencia,pendente_definicao,proposta_acao' }) }),
    ),
    panel('Pendências por área', d.by_area.length ? h('div', { class: 'area-grid' }, d.by_area.map((a) => h('div', { class: 'area-card', onClick: () => navigate('areas', { area: a.area }) },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('b', {}, AREA_SHORT[a.area] || a.name), h('span', { class: 'n' }, a.open)),
      h('div', { class: 'muted', style: { fontSize: '12px' } }, `${a.in_progress} em andamento`, a.overdue ? h('span', { class: 'red' }, ` · ${a.overdue} atrasadas`) : null, a.blocked ? h('span', { class: 'amber' }, ` · ${a.blocked} bloqueadas`) : null, a.no_owner ? ` · ${a.no_owner} sem dono` : null),
    ))) : empty('Sem tarefas abertas'), h('a', { href: '#/areas' }, 'Ver por área')),
    h('div', { class: 'grid-2', style: { marginTop: '18px' } },
      panel('Marcos críticos e próximos', d.milestones.length ? h('ul', { class: 'list' }, d.milestones.map((m) => h('li', {}, companyDot(m.company_slug), h('div', { class: 't' }, h('div', {}, m.critical ? h('span', { class: 'badge red outline', style: { marginRight: '6px' } }, 'crítico') : null, m.name), h('div', { class: 'sub' }, m.due_date ? `${fmtDate(m.due_date)} · ${m.date_kind === 'acordado' ? 'acordado' : 'sugerido'}` : 'Sem data definida', m.is_overdue ? ' · atrasado' : '')), h('span', { class: 'badge' }, { planejado: 'Planejado', em_andamento: 'Em andamento', concluido: 'Concluído', atrasado: 'Atrasado', cancelado: 'Cancelado' }[m.status])))) : empty('Sem marcos abertos'), h('a', { href: '#/roadmap' }, 'Roadmap')),
      panel('Próximas entregas com prazo', d.next_deliveries.length ? h('ul', { class: 'list' }, d.next_deliveries.map((t) => h('li', { class: 'clickable', onClick: () => openTask(t.id) }, companyDot(t.company_slug), h('div', { class: 't' }, h('div', {}, h('span', { class: 'code' }, t.code), ' ', t.title), h('div', { class: 'sub' }, `${fmtDate(t.due_date)} · ${t.due_kind === 'acordado' ? 'prazo acordado' : 'prazo sugerido'} · ${t.assignee_name || 'sem responsável'}`)), statusBadge(t.status)))) : empty('Nenhuma tarefa aberta com prazo futuro', 'A maioria das tarefas migradas não tem prazo acordado: defina prazos no Kanban ou na lista de tarefas.'), h('a', { href: '#/tasks?open=1' }, 'Todas')),
      panel('Riscos relevantes', d.risks.length ? h('ul', { class: 'list' }, d.risks.map((r) => h('li', { class: 'clickable', onClick: () => navigate('risks', { open: r.id }) }, companyDot(r.company_slug), h('div', { class: 't' }, h('div', {}, r.title), h('div', { class: 'sub' }, `${r.owner_name || 'sem responsável'} · ${{ aberto: 'aberto', mitigando: 'mitigando', monitorando: 'monitorando', materializado: 'materializado' }[r.status] || r.status}`)), h('span', { class: `badge ${r.score >= 15 ? 'red' : r.score >= 8 ? 'amber' : ''}` }, `P${r.probability} × I${r.impact} = ${r.score}`)))) : empty('Sem riscos abertos'), h('a', { href: '#/risks' }, 'Riscos')),
      panel('Decisões que dependem da direção', d.pending_decisions.length ? h('ul', { class: 'list' }, d.pending_decisions.map((x) => h('li', { class: 'clickable', onClick: () => navigate('risks', { tab: 'decisions', open: x.id }) }, companyDot(x.company_slug), h('div', { class: 't' }, h('div', {}, x.title), h('div', { class: 'sub' }, `${x.owner_name || 'sem responsável'}${x.due_date ? ' · até ' + fmtDate(x.due_date) : ' · sem prazo'}`))))) : empty('Nenhuma decisão pendente'), h('a', { href: '#/risks?tab=decisions' }, 'Decisões')),
      panel('O que mais impede entregas', d.top_blockers.length ? h('ul', { class: 'list' }, d.top_blockers.map((b) => h('li', { class: 'clickable', onClick: () => openTask(b.id) }, companyDot(b.company_slug), h('div', { class: 't' }, h('div', {}, h('span', { class: 'code' }, b.code), ' ', b.title), h('div', { class: 'sub' }, `${b.assignee_name || 'sem responsável'} · trava ${b.direct} diretamente, ${b.downstream_open} na cadeia${b.critical_downstream ? `, ${b.critical_downstream} críticas/marcos` : ''}`)), statusBadge(b.status)))) : empty('Nenhum bloqueio em cadeia'), h('a', { href: '#/dependencies' }, 'Mapa')),
      panel('Responsáveis com entregas pendentes', d.workload.length ? h('ul', { class: 'list' }, d.workload.map((w) => h('li', { class: 'clickable', onClick: () => navigate('command-center', { person: w.assignee_id || 'none' }) }, h('div', { class: 't' }, h('div', {}, w.assignee_name), h('div', { class: 'sub' }, `${w.open} abertas · ${w.in_progress} em andamento${w.overdue ? ` · ${w.overdue} atrasadas` : ''}${w.blocked ? ` · ${w.blocked} bloqueadas` : ''}${w.critical ? ` · ${w.critical} críticas` : ''}`)), w.sla_breached ? h('span', { class: 'badge red' }, `${w.sla_breached} SLA`) : null))) : empty('Sem tarefas abertas'), h('a', { href: '#/sla' }, 'SLA Center')),
    ),
    h('div', { class: 'section', style: { marginTop: '18px' } }, h('div', { class: 'grid-3' },
      panel('Qualidade', h('div', { class: 'body' }, h('div', { class: 'dl-inline' }, line('Bugs abertos', d.quality.bugs_open), line('Bugs críticos abertos', d.quality.bugs_critical_open), line('Bugs resolvidos', d.quality.bugs_resolved), line('Reincidências', d.quality.recurrences), line('Em validação/homologação', d.quality.in_validation), line('Cobertura de testes', d.quality.test_coverage == null ? nodata() : d.quality.test_coverage)))),
      panel('Produto e releases', h('div', { class: 'body' }, line('Releases registradas', d.releases.releases_total), line('Publicadas', d.releases.published), line('Com falha', d.releases.failed), line('Incidentes pós-lançamento', d.releases.incidents), d.releases.readiness.length ? d.releases.readiness.map((r) => line(`Prontidão ${r.platform.toUpperCase()}`, r.pct == null ? nodata() : `${r.pct}% (${r.done}/${r.total}${r.blocked ? `, ${r.blocked} bloqueadas` : ''})`)) : line('Prontidão para lojas', nodata('Sem esteira cadastrada')))),
      panel('Marketing e financeiro', h('div', { class: 'body' }, line('Campanhas ativas', d.marketing.campaigns_active, `de ${d.marketing.campaigns_total}`), line('Orçamento planejado', fmtMoney(d.marketing.budget_planned_cents)), line('Realizado', fmtMoney(d.marketing.budget_actual_cents)), line('Leads / conversões', d.marketing.leads == null ? nodata() : `${d.marketing.leads} / ${d.marketing.conversions ?? '—'}`), line('Usuários ativos', nodata()), line('Receita e assinaturas', nodata('Sem integração')), line('Custo recorrente mensal registrado', fmtMoney(d.finance.monthly_recurring_cost_cents)), line('Itens financeiros sem valor', d.finance.items_without_amount))),
    )),
  );
  ctx.onUnmount(onTaskChanged(() => ctx.refresh()));
}

function personFilter(m, navigate) {
  const people = (m.people || []).filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const sel = h('select', { 'aria-label': 'Responsável', title: 'Ver as pendências de uma pessoa', style: { fontWeight: 600, fontSize: '13px', color: 'var(--ink)', padding: '7px 10px', border: '1px solid var(--blue)', borderRadius: 'var(--radius)', background: 'var(--paper)', cursor: 'pointer' } },
    h('option', { value: '' }, 'Responsável: todos'), people.map((p) => h('option', { value: String(p.id) }, p.name)), h('option', { value: 'none' }, 'Sem responsável'));
  sel.addEventListener('change', () => { if (sel.value) navigate('command-center', { person: sel.value }); });
  return sel;
}

function line(label, value, sub = null) { return h('div', { class: 'row', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--line)', fontSize: '13px' } }, h('span', { class: 'muted' }, label), h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, value == null ? nodata() : value, sub ? h('span', { class: 'muted' }, ` ${sub}`) : null)); }
