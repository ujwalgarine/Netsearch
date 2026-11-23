// Insights (/app/insights): analytics from the user's own activity (GET /api/insights/summary)
// and networking tips (POST /api/insights/tips). Charts are drawn with D3 v7.
// Uses request, el, icon, toast from app.js and PIPELINE_STAGES, fmtDay, localToday from connections.js.

const ix = {
  root: $('insights-body'),
  kpis: $('kpi-row'),
  kpiNote: $('kpi-note'),
  funnel: $('chart-funnel'),
  mixBranch: $('chart-mix-branch'),
  mixOrg: $('chart-mix-org'),
  activity: $('chart-activity'),
  followups: $('followups'),
  tips: $('tips'),
  tipsNote: $('tips-note'),
  refresh: $('tips-refresh'),
  tip: $('chart-tip'),
  trend: $('chart-trend'),
  summary: null,
  practice: null, // practice sessions (GET /api/practice), for the score trend
  seq: 0,
};

const pct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
const nf = new Intl.NumberFormat();

async function showInsights() {
  const seq = ++ix.seq;
  ix.root.classList.add('refreshing'); // keep the previous frame while refetching
  try {
    const [summary, practice] = await Promise.all([
      request('GET', `/api/insights/summary?today=${localToday()}`),
      request('GET', '/api/practice').catch(() => ({ sessions: [] })),
    ]);
    if (seq !== ix.seq) return;
    ix.summary = summary;
    ix.practice = practice.sessions;
    renderInsights();
  } catch (err) {
    if (seq === ix.seq) toast(`Couldn't load insights: ${err.message}`);
  } finally {
    if (seq === ix.seq) ix.root.classList.remove('refreshing');
  }
  loadTips();
}

function renderInsights() {
  const s = ix.summary;
  if (!s) return;
  renderKpis(s);
  renderFunnel(s);
  renderMix(s);
  renderActivity(s);
  renderFollowups(s);
  renderTrend();
}

// Charts re-flow on width changes only (D3 draws to the measured width).
let lastWidth = 0;
new ResizeObserver(() => {
  const w = ix.root.clientWidth;
  if (!ix.summary || Math.abs(w - lastWidth) < 4 || $('view-insights').hidden) return;
  lastWidth = w;
  renderActivity(ix.summary);
  renderTrend();
}).observe(ix.root);

// ---- empty state, one line with the next step ----
function emptyState(text, link) {
  const box = el('div', 'module-empty');
  box.append(el('span', 'empty-dot'), el('p', null, text));
  if (link) {
    const a = el('a', 'quiet-link', `${link.label} →`);
    a.href = link.href;
    a.dataset.nav = link.nav;
    box.append(a);
  }
  return box;
}

// ---- tooltip shared by every chart: value first, label second ----
function showTip(target, value, label) {
  const tip = ix.tip;
  tip.replaceChildren(el('strong', null, value), el('span', null, label));
  tip.hidden = false;
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 8);
  const y = r.top - t.height - 8 < 8 ? r.bottom + 8 : r.top - t.height - 8;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
const hideTip = () => { ix.tip.hidden = true; };
window.addEventListener('scroll', hideTip, true);

function hoverable(sel, value, label) {
  sel
    .attr('tabindex', 0)
    .on('pointerenter focus', function (_e, d) { showTip(this, value(d), label(d)); })
    .on('pointerleave blur', hideTip);
}

// ---- "Table" toggle: every chart's numbers without hovering ----
function withTable(container, draw, columns, rows) {
  const card = container.closest('.chart-card');
  const toggle = card?.querySelector('.table-toggle');
  const showTable = toggle?.getAttribute('aria-pressed') === 'true';
  container.replaceChildren();
  if (showTable) {
    const wrap = el('div', 'table-scroll');
    const table = el('table', 'data-table');
    const thead = el('thead');
    const hr = el('tr');
    columns.forEach((c) => hr.append(el('th', c.num ? 'num' : null, c.label)));
    thead.append(hr);
    const tbody = el('tbody');
    rows.forEach((r) => {
      const tr = el('tr');
      columns.forEach((c) => tr.append(el('td', c.num ? 'num' : null, c.value(r))));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    container.append(wrap);
  } else {
    draw(container);
  }
}
document.addEventListener('click', (e) => {
  const t = e.target.closest('.table-toggle');
  if (!t) return;
  const on = t.getAttribute('aria-pressed') !== 'true';
  t.setAttribute('aria-pressed', String(on));
  t.textContent = on ? 'Chart' : 'Table';
  renderInsights();
});

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function renderKpis(s) {
  const k = s.kpis;
  const tiles = [
    { label: 'Maps created', value: nf.format(k.maps_created), foot: k.maps_created ? 'All time' : 'None yet' },
    { label: 'Connections saved', value: nf.format(k.connections_saved), foot: k.connections_saved ? 'Being tracked' : 'None yet' },
    { label: 'Reached out', value: nf.format(k.reached_out), foot: k.connections_saved ? `of ${nf.format(k.connections_saved)} saved` : 'None yet' },
    { label: 'Reply rate', value: pct(k.reply_rate), foot: k.reached_out ? `${k.replied} of ${k.reached_out} replied` : 'No one contacted yet', accent: k.reply_rate != null },
    { label: 'Coffee chats met', value: nf.format(k.met), foot: k.met ? 'Marked Met' : 'None yet' },
    { label: 'Practice sessions', value: nf.format(k.practice_completed), foot: k.practice_completed ? 'Completed' : 'None yet' },
  ];
  d3.select(ix.kpis)
    .selectAll('div.kpi')
    .data(tiles)
    .join((enter) => {
      const d = enter.append('div').attr('class', 'kpi');
      d.append('p').attr('class', 'kpi-label label');
      d.append('p').attr('class', 'kpi-value');
      d.append('p').attr('class', 'kpi-foot');
      return d;
    })
    .classed('kpi-hi', (d) => Boolean(d.accent))
    .call((d) => d.select('.kpi-label').text((t) => t.label))
    .call((d) => d.select('.kpi-value').text((t) => t.value))
    .call((d) => d.select('.kpi-foot').text((t) => t.foot));

  const fresh = !k.maps_created && !k.connections_saved;
  ix.kpiNote.hidden = !fresh;
  if (fresh) ix.kpiNote.replaceChildren(emptyState('Create your first map to start building your network.', { label: 'New map', href: '/app', nav: 'map' }));
}

// ---------------------------------------------------------------------------
// Outreach funnel: one bar per stage (reached), conversion between stages
// ---------------------------------------------------------------------------

function renderFunnel(s) {
  if (!s.kpis.connections_saved) {
    ix.funnel.replaceChildren(emptyState('Save a connection from your map to start tracking outreach.', { label: 'Open a map', href: '/app/chats', nav: 'chats' }));
    return;
  }
  const max = s.funnel[0].reached || 1;
  withTable(
    ix.funnel,
    (box) => {
      const rows = d3.select(box).append('ol').attr('class', 'bars funnel').attr('aria-label', 'Outreach funnel');
      const li = rows.selectAll('li').data(s.funnel).join('li');
      li.filter((_d, i) => i > 0)
        .append('p')
        .attr('class', 'conversion mono')
        .text((d) => (d.conversion == null ? '—' : `${pct(d.conversion)} moved on`));
      const head = li.append('div').attr('class', 'bar-head');
      head.append('span').attr('class', 'bar-label').text((d) => d.label);
      head.append('span').attr('class', 'bar-value').text((d) => nf.format(d.reached));
      const track = li.append('div').attr('class', 'bar-track');
      track
        .append('div')
        .attr('class', 'bar primary')
        .style('width', (d) => (d.reached ? `max(4px, ${(d.reached / max) * 100}%)` : '0'))
        .attr('aria-label', (d) => `${d.label}: ${d.reached} reached, ${d.current} at this stage now`)
        .call((b) => hoverable(b, (d) => nf.format(d.reached), (d) => `${d.label} · ${d.current} here now${d.conversion == null ? '' : ` · ${pct(d.conversion)} of previous`}`));
    },
    [
      { label: 'Stage', value: (d) => d.label },
      { label: 'Reached', num: true, value: (d) => nf.format(d.reached) },
      { label: 'At stage now', num: true, value: (d) => nf.format(d.current) },
      { label: 'From previous', num: true, value: (d) => pct(d.conversion) },
    ],
    s.funnel,
  );
}

// ---------------------------------------------------------------------------
// Network mix: ranked bars by branch and by organization
// ---------------------------------------------------------------------------

function rankedBars(container, data, name) {
  const max = d3.max(data, (d) => d.count) || 1;
  const total = d3.sum(data, (d) => d.count) || 1;
  withTable(
    container,
    (box) => {
      const li = d3.select(box).append('ol').attr('class', 'bars ranked').attr('aria-label', name).selectAll('li').data(data).join('li');
      const head = li.append('div').attr('class', 'bar-head');
      head.append('span').attr('class', 'bar-label').text((d) => d.label);
      head.append('span').attr('class', 'bar-value').text((d) => nf.format(d.count));
      li.append('div')
        .attr('class', 'bar-track')
        .append('div')
        .attr('class', (d) => `bar ${d.other ? 'other' : 'secondary'}`)
        .style('width', (d) => `max(4px, ${(d.count / max) * 100}%)`)
        .attr('aria-label', (d) => `${d.label}: ${d.count}`)
        .call((b) => hoverable(b, (d) => nf.format(d.count), (d) => `${d.label} · ${pct(d.count / total)} of saved`));
    },
    [
      { label: name, value: (d) => d.label },
      { label: 'Saved', num: true, value: (d) => nf.format(d.count) },
      { label: 'Share', num: true, value: (d) => pct(d.count / total) },
    ],
    data,
  );
}

function renderMix(s) {
  if (!s.mix.total) {
    ix.mixBranch.replaceChildren(emptyState('Save people from a few branches to see where your network sits.'));
    ix.mixOrg.replaceChildren(emptyState('Organizations appear once you save connections.'));
    return;
  }
  rankedBars(ix.mixBranch, s.mix.branches, 'Branch');
  if (s.mix.organizations.length) rankedBars(ix.mixOrg, s.mix.organizations, 'Organization');
  else ix.mixOrg.replaceChildren(emptyState('None of your saved connections list an organization yet.'));
}

// ---------------------------------------------------------------------------
// Activity: three small multiples (weekly columns, last 12 weeks), one series each
// ---------------------------------------------------------------------------

const ACTIVITY = [
  { key: 'outreach', label: 'Outreach updates', unit: ['status change', 'status changes'], cls: 'primary' },
  { key: 'maps', label: 'Maps created', unit: ['map', 'maps'], cls: 'secondary' },
  { key: 'practice', label: 'Practice completed', unit: ['session', 'sessions'], cls: 'secondary' },
];

function renderActivity(s) {
  const weeks = s.activity.weeks;
  const any = weeks.some((w) => w.maps || w.outreach || w.practice);
  if (!any) {
    ix.activity.replaceChildren(emptyState('Weekly activity shows up once you create maps and move connections along.'));
    return;
  }
  withTable(
    ix.activity,
    (box) => {
      const grid = el('div', 'multiples');
      box.append(grid);
      for (const series of ACTIVITY) {
        const cell = el('figure', 'multiple');
        const total = d3.sum(weeks, (w) => w[series.key]);
        const cap = el('figcaption');
        cap.append(el('span', 'label', series.label), el('span', 'multiple-total', nf.format(total)));
        cell.append(cap);
        grid.append(cell);
        if (total) drawColumns(cell, weeks, series);
        else cell.append(el('p', 'multiple-none', 'None in the last 12 weeks.'));
      }
    },
    [
      { label: 'Week of', value: (w) => fmtDay(w.start) },
      ...ACTIVITY.map((a) => ({ label: a.label, num: true, value: (w) => nf.format(w[a.key]) })),
    ],
    weeks,
  );
}

function drawColumns(cell, weeks, series) {
  const width = Math.max(200, cell.clientWidth || 280);
  const height = 120;
  const m = { top: 14, right: 4, bottom: 22, left: 4 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const max = d3.max(weeks, (w) => w[series.key]) || 1;
  const x = d3.scaleBand().domain(weeks.map((w) => w.start)).range([0, innerW]).paddingInner(0.25);
  const y = d3.scaleLinear().domain([0, max]).range([innerH, 0]);
  const bw = Math.min(24, x.bandwidth());
  const r = Math.min(4, bw / 2);

  const svg = d3
    .select(cell)
    .append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', height)
    .attr('role', 'img')
    .attr('aria-label', `${series.label} per week, last 12 weeks. Peak ${max}.`);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  g.append('line').attr('class', 'baseline').attr('x1', 0).attr('x2', innerW).attr('y1', innerH).attr('y2', innerH);
  g.append('text').attr('class', 'tick').attr('x', 0).attr('y', -4).text(`peak ${max}`);

  // Columns: 4px rounded top, square on the baseline.
  const col = (w) => {
    const v = w[series.key];
    if (!v) return '';
    const x0 = x(w.start) + (x.bandwidth() - bw) / 2;
    const top = y(v);
    const h = innerH - top;
    const rr = Math.min(r, h);
    return `M${x0},${innerH}V${top + rr}Q${x0},${top} ${x0 + rr},${top}H${x0 + bw - rr}Q${x0 + bw},${top} ${x0 + bw},${top + rr}V${innerH}Z`;
  };
  g.selectAll('path.col').data(weeks).join('path').attr('class', `col ${series.cls}`).attr('d', col);

  // Hit targets: the whole week band, taller than the mark.
  g.selectAll('rect.hit')
    .data(weeks)
    .join('rect')
    .attr('class', 'hit')
    .attr('x', (w) => x(w.start))
    .attr('y', 0)
    .attr('width', x.bandwidth())
    .attr('height', innerH)
    .attr('aria-label', (w) => `Week of ${fmtDay(w.start)}: ${w[series.key]} ${series.unit[w[series.key] === 1 ? 0 : 1]}`)
    .call((h) => hoverable(h, (w) => nf.format(w[series.key]), (w) => `${series.unit[w[series.key] === 1 ? 0 : 1]} · week of ${fmtDay(w.start)}`));

  const ticks = [weeks[0], weeks[weeks.length - 1]];
  g.selectAll('text.xt')
    .data(ticks)
    .join('text')
    .attr('class', 'tick')
    .attr('x', (w, i) => (i === 0 ? x(w.start) : x(w.start) + x.bandwidth()))
    .attr('y', innerH + 15)
    .attr('text-anchor', (_w, i) => (i === 0 ? 'start' : 'end'))
    .text((w) => fmtDay(w.start));
}

// ---------------------------------------------------------------------------
// Practice score trend: one point per completed practice chat, oldest to newest
// ---------------------------------------------------------------------------

function renderTrend() {
  const done = (ix.practice ?? [])
    .filter((s) => s.status === 'completed' && typeof s.score === 'number')
    .sort((a, b) => new Date(a.ended_at || a.created_at) - new Date(b.ended_at || b.created_at));
  if (done.length < 2) {
    ix.trend.replaceChildren(
      emptyState(
        done.length ? 'Finish one more practice chat to see your trend.' : 'Complete two practice chats to see how your score moves.',
        { label: 'Practice', href: '/app/practice/new', nav: 'practice' },
      ),
    );
    return;
  }
  const when = (s) => s.ended_at || s.created_at;
  withTable(
    ix.trend,
    (box) => drawTrend(box, done, when),
    [
      { label: 'Date', value: (s) => fmtDay(when(s)) },
      { label: 'Connection', value: (s) => s.connection.name || '—' },
      { label: 'Goal', value: (s) => s.goal },
      { label: 'Score', num: true, value: (s) => `${s.score}/10` },
    ],
    done,
  );
}

function drawTrend(box, data, when) {
  const width = Math.max(260, box.clientWidth || 600);
  const height = 210;
  const m = { top: 18, right: 18, bottom: 26, left: 28 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const x = d3.scalePoint().domain(data.map((_d, i) => i)).range([0, innerW]).padding(0.4);
  // Clamped, so a score off the 0-10 scale can never draw outside the card.
  const y = d3.scaleLinear().domain([0, 10]).range([innerH, 0]).clamp(true);
  const first = data[0].score;
  const last = data[data.length - 1].score;
  const change = Math.round((last - first) * 10) / 10;

  const svg = d3
    .select(box)
    .append('svg')
    .attr('class', 'trend')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', height)
    .attr('role', 'img')
    .attr('aria-label', `Practice scores over ${data.length} chats, from ${first} to ${last} out of 10.`);
  const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

  for (const v of [0, 5, 10]) {
    g.append('line').attr('class', v ? 'grid' : 'baseline').attr('x1', 0).attr('x2', innerW).attr('y1', y(v)).attr('y2', y(v));
    g.append('text').attr('class', 'tick').attr('x', -8).attr('y', y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').text(v);
  }

  const area = d3.area().x((_d, i) => x(i)).y0(innerH).y1((d) => y(d.score)).curve(d3.curveMonotoneX);
  const line = d3.line().x((_d, i) => x(i)).y((d) => y(d.score)).curve(d3.curveMonotoneX);
  g.append('path').attr('class', 'trend-area').attr('d', area(data));
  g.append('path').attr('class', 'trend-line').attr('d', line(data));

  g.selectAll('circle.pt')
    .data(data)
    .join('circle')
    .attr('class', (_d, i) => `pt${i === data.length - 1 ? ' last' : ''}`)
    .attr('cx', (_d, i) => x(i))
    .attr('cy', (d) => y(d.score))
    .attr('r', (_d, i) => (i === data.length - 1 ? 5.5 : 4));

  // The latest score, labelled; the change since the first chat.
  g.append('text')
    .attr('class', 'trend-last')
    .attr('x', x(data.length - 1))
    .attr('y', y(last) - 14)
    .attr('text-anchor', 'middle')
    .text(`${last}/10`);
  g.append('text')
    .attr('class', 'tick')
    .attr('x', innerW)
    .attr('y', -6)
    .attr('text-anchor', 'end')
    .text(change === 0 ? 'no change since first' : `${change > 0 ? '+' : '−'}${Math.abs(change)} since first`);

  // Hit targets: a tall band per chat.
  const band = innerW / data.length;
  g.selectAll('rect.hit')
    .data(data)
    .join('rect')
    .attr('class', 'hit')
    .attr('x', (_d, i) => x(i) - band / 2)
    .attr('y', 0)
    .attr('width', band)
    .attr('height', innerH)
    .attr('aria-label', (d) => `${fmtDay(when(d))}, ${d.connection.name || 'practice chat'}: ${d.score} out of 10`)
    .call((h) => hoverable(h, (d) => `${d.score}/10`, (d) => `${d.connection.name || 'Practice chat'} · ${fmtDay(when(d))}`));

  g.selectAll('text.xt')
    .data([0, data.length - 1])
    .join('text')
    .attr('class', 'tick')
    .attr('x', (i) => x(i))
    .attr('y', innerH + 17)
    .attr('text-anchor', (i) => (i === 0 ? 'start' : 'end'))
    .text((i) => fmtDay(when(data[i])));
}

// ---------------------------------------------------------------------------
// Follow-ups due
// ---------------------------------------------------------------------------

function renderFollowups(s) {
  if (!s.followups.length) {
    ix.followups.replaceChildren(emptyState('Nothing due. Set a follow-up date on a connection to get a reminder here.', { label: 'Connections', href: '/app/connections', nav: 'connections' }));
    return;
  }
  const ul = el('ul', 'followup-list');
  for (const f of s.followups) {
    const li = el('li');
    const a = el('a', 'followup');
    a.href = `/app/connections/${f.id}`;
    a.dataset.nav = 'connections';
    const who = el('span', 'fu-who');
    who.append(el('span', 'fu-name', f.name || 'Unnamed'), el('span', 'fu-org', [f.title, f.organization].filter(Boolean).join(' · ')));
    const why =
      f.reason === 'follow_up'
        ? f.days === 0
          ? 'Follow-up due today'
          : `Follow-up was due ${fmtDay(f.follow_up_on)} · ${f.days} ${f.days === 1 ? 'day' : 'days'} ago`
        : `Contacted ${f.days} days ago, no reply yet`;
    a.append(who, el('span', `fu-why mono${f.reason === 'follow_up' && f.days > 0 ? ' overdue' : ''}`, why));
    li.append(a);
    ul.append(li);
  }
  ix.followups.replaceChildren(ul);
}

// ---------------------------------------------------------------------------
// Networking tips
// ---------------------------------------------------------------------------

let tipsSeq = 0;
async function loadTips() {
  const seq = ++tipsSeq;
  ix.refresh.disabled = true;
  ix.refresh.setAttribute('aria-busy', 'true');
  ix.tips.classList.add('refreshing');
  if (!ix.tips.children.length) ix.tips.replaceChildren(el('p', 'label tips-loading', 'Reading your network…'));
  try {
    const data = await request('POST', '/api/insights/tips', {});
    if (seq !== tipsSeq) return;
    renderTips(data);
  } catch (err) {
    if (seq !== tipsSeq) return;
    ix.tips.replaceChildren(emptyState(err.message || "Couldn't load tips."));
  } finally {
    if (seq === tipsSeq) {
      ix.refresh.disabled = false;
      ix.refresh.removeAttribute('aria-busy');
      ix.tips.classList.remove('refreshing');
    }
  }
}
ix.refresh.addEventListener('click', loadTips);

function tipAction(a) {
  if (!a || a.type === 'none') return null;
  const href =
    a.type === 'open_connection' ? `/app/connections/${a.connection_id}`
      : a.type === 'practice' ? (a.connection_id ? practiceHref(a.connection_id) : '/app/practice')
        : '/app';
  const nav = a.type === 'open_connection' ? 'connections' : a.type === 'practice' ? 'practice' : 'map';
  const link = el('a', 'pill pill-ghost sm', a.label || 'Open');
  link.href = href;
  link.dataset.nav = nav;
  link.append(icon('arrow-right'));
  return link;
}

function renderTips(data) {
  const notes = { demo: 'Demo · written from your data without the AI model', starter: 'Getting started', llm: '' };
  ix.tipsNote.textContent = notes[data.source] ?? '';
  ix.tipsNote.hidden = !ix.tipsNote.textContent;
  ix.tips.replaceChildren(
    ...data.tips.map((t, i) => {
      const card = el('article', 'tip glass');
      card.style.setProperty('--i', i);
      const top = el('div', 'tip-top');
      top.append(el('span', 'tip-index mono', String(i + 1).padStart(2, '0')));
      if (data.source === 'demo') top.append(el('span', 'badge label', 'Demo'));
      card.append(top, el('h3', null, t.title), el('p', 'tip-body', t.body));
      const based = el('p', 'tip-based mono');
      based.append(el('span', null, 'Based on: '), document.createTextNode(t.based_on));
      card.append(based);
      const action = tipAction(t.action);
      if (action) card.append(action);
      return card;
    }),
  );
}
