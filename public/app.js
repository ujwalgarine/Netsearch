// Working title shown in the header. Change it here.
const APP_NAME = 'NetPrep';

const state = {
  messages: [], // full conversation sent to the server
  map: null,    // latest network map from the model
  loading: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  appName: $('app-name'),
  badge: $('mode-badge'),
  messages: $('messages'),
  form: $('composer'),
  input: $('input'),
  send: $('send'),
  empty: $('empty'),
  mapTitle: $('map-title'),
  fit: $('fit'),
  reset: $('reset'),
  detail: $('detail'),
  detailBody: $('detail-body'),
  detailClose: $('detail-close'),
};

els.appName.textContent = APP_NAME;
document.title = `${APP_NAME} · prototype`;

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    if (s.mock) {
      els.badge.hidden = false;
      els.badge.title = 'No OpenAI key found. Add it to .env and restart the server.';
    }
  })
  .catch(() => {});

document.querySelectorAll('.chip').forEach((chip) =>
  chip.addEventListener('click', () => submit(chip.textContent.trim())),
);

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(els.input.value);
});

els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit(els.input.value);
  }
});

els.input.addEventListener('input', () => {
  els.input.style.height = 'auto';
  els.input.style.height = `${els.input.scrollHeight}px`;
});

els.reset.addEventListener('click', resetAll);
els.fit.addEventListener('click', () => fitToView(true));
els.detailClose.addEventListener('click', dismissDetail);
document.addEventListener('keydown', (e) => e.key === 'Escape' && dismissDetail());

async function submit(raw) {
  const text = raw.trim();
  if (!text || state.loading) return;

  document.querySelector('.intro')?.remove();
  els.input.value = '';
  els.input.style.height = 'auto';

  addMessage('user', text);
  state.messages.push({ role: 'user', content: text });
  setLoading(true);

  try {
    const res = await fetch('/api/network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    state.map = data;
    // Keep a compact copy of the map in history so follow-ups can refine it.
    state.messages.push({
      role: 'assistant',
      content: JSON.stringify({
        reply: data.reply,
        goal: data.goal,
        branches: data.branches.map((b) => ({
          label: b.label,
          connections: b.connections.map((c) => `${c.title} @ ${c.organization}`),
        })),
      }),
    });

    const count = data.branches.reduce((n, b) => n + b.connections.length, 0);
    addMessage('assistant', data.reply, `${data.branches.length} branches · ${count} connections`);
    renderMap(data);
  } catch (err) {
    // Drop the failed user turn so a retry doesn't send it twice.
    if (state.messages.at(-1)?.role === 'user') state.messages.pop();
    addMessage('error', err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
    els.input.focus();
  }
}

function addMessage(kind, text, meta) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.textContent = text;
  if (meta) {
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    div.appendChild(m);
  }
  els.messages.appendChild(div);
  els.messages.scrollTop = els.messages.scrollHeight;
}

let thinkingEl = null;
function setLoading(on) {
  state.loading = on;
  els.send.disabled = on;
  if (on) {
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking';
    thinkingEl.textContent = state.map ? 'Redrawing your map…' : 'Mapping your network…';
    els.messages.appendChild(thinkingEl);
    els.messages.scrollTop = els.messages.scrollHeight;
  } else {
    thinkingEl?.remove();
    thinkingEl = null;
  }
}

function resetAll() {
  state.messages = [];
  state.map = null;
  closeDetail();
  g.selectAll('*').remove();
  els.empty.hidden = false;
  els.fit.disabled = true;
  els.reset.disabled = true;
  els.mapTitle.textContent = 'Network map';
  els.messages.innerHTML = '';
  addMessage('assistant', 'Fresh start. Who do you want to meet?');
}

// ---------------------------------------------------------------------------
// Map (D3 tidy tree: goal -> branches -> connections)
// ---------------------------------------------------------------------------

const svg = d3.select('#graph');
const g = svg.append('g');
const zoom = d3
  .zoom()
  .scaleExtent([0.25, 2.5])
  .on('zoom', (e) => g.attr('transform', e.transform));
svg.call(zoom).on('dblclick.zoom', null);

const CARD_W = 236;
const CARD_H = 44;
const STAGE = 450; // ms between tree levels growing in

const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sibIndex = (d) => (d.parent ? d.parent.children.indexOf(d) : 0);
const delayFor = (d) => (d.depth === 0 ? 0 : (d.depth - 1) * STAGE + sibIndex(d) * 70);

function wrap(text, max) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function renderMap(data) {
  els.empty.hidden = true;
  els.fit.disabled = false;
  els.reset.disabled = false;
  els.mapTitle.textContent = `Network map · ${data.goal}`;
  closeDetail();

  const root = d3.hierarchy({
    name: data.goal,
    kind: 'root',
    children: data.branches.map((b) => ({
      name: b.label,
      kind: 'branch',
      data: b,
      children: b.connections.map((c) => ({ name: c.title, kind: 'person', data: c, branch: b.label })),
    })),
  });

  d3.tree()
    .nodeSize([CARD_H + 16, 290])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.5))(root);

  g.selectAll('*').remove();

  // Links draw themselves in, level by level.
  g.append('g')
    .selectAll('path')
    .data(root.links())
    .join('path')
    .attr('class', (d) => `link depth-${d.target.depth}`)
    .attr('d', d3.linkHorizontal().x((d) => d.y).y((d) => d.x))
    .each(function (d) {
      const len = this.getTotalLength();
      d3.select(this)
        .attr('stroke-dasharray', len)
        .attr('stroke-dashoffset', len)
        .transition()
        .delay(delayFor(d.target))
        .duration(650)
        .ease(d3.easeCubicOut)
        .attr('stroke-dashoffset', 0)
        .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
    });

  const node = g
    .append('g')
    .selectAll('g')
    .data(root.descendants())
    .join('g')
    .attr('class', (d) => `node ${d.data.kind}`)
    .attr('transform', (d) => `translate(${d.y},${d.x})`)
    .style('opacity', 0);

  node
    .transition()
    .delay((d) => (d.depth === 0 ? 0 : delayFor(d) + 380))
    .duration(380)
    .style('opacity', 1);

  // Root: the user's goal
  const rootG = node.filter((d) => d.depth === 0);
  rootG.append('circle').attr('class', 'halo').attr('r', 15);
  rootG.append('circle').attr('r', 7);
  const rootText = rootG.append('text').attr('text-anchor', 'end').attr('x', -26);
  const lines = wrap(data.goal, 22);
  lines.forEach((l, i) =>
    rootText
      .append('tspan')
      .attr('x', -26)
      .attr('dy', i === 0 ? `${0.35 - (lines.length - 1) * 0.55}em` : '1.1em')
      .text(l),
  );

  // Branches: categories
  const branchG = node.filter((d) => d.data.kind === 'branch');
  branchG.append('rect').attr('x', -5).attr('y', -5).attr('width', 10).attr('height', 10).attr('transform', 'rotate(45)');
  branchG.append('text').attr('x', 0).attr('y', -14).attr('text-anchor', 'middle').text((d) => truncate(d.data.name, 34));
  branchG.on('click', (_e, d) => openBranch(d.data.data));

  // People: connection cards
  const personG = node.filter((d) => d.data.kind === 'person');
  personG.append('rect').attr('class', 'card').attr('x', 0).attr('y', -CARD_H / 2).attr('width', CARD_W).attr('height', CARD_H).attr('rx', 5);
  personG.append('rect').attr('class', 'bar').attr('x', 0).attr('y', -CARD_H / 2).attr('width', 3).attr('height', CARD_H).attr('rx', 1.5);
  personG.append('text').attr('class', 'title').attr('x', 14).attr('y', -3).text((d) => truncate(d.data.name, 31));
  personG.append('text').attr('class', 'org').attr('x', 14).attr('y', 13).text((d) => truncate(d.data.data.organization, 34));
  personG.append('title').text((d) => `${d.data.name}, ${d.data.data.organization}`);
  personG.on('click', function (_e, d) {
    g.selectAll('.node.person').classed('active', false);
    d3.select(this).classed('active', true);
    openPerson(d.data.data, d.data.branch);
  });

  fitToView(false);
}

function fitToView(animate) {
  const box = g.node().getBBox();
  if (!box.width) return;
  const rect = svg.node().getBoundingClientRect();
  const { height } = rect;
  // Fit into the space left of the detail panel, unless it covers the whole map (narrow screens).
  const panel = els.detail.classList.contains('open') ? els.detail.offsetWidth : 0;
  const width = rect.width - panel >= 300 ? rect.width - panel : rect.width;
  const pad = 56;
  const k = Math.max(0.3, Math.min(1.1, (width - pad * 2) / box.width, (height - pad * 2 - 30) / box.height));
  const tx = width / 2 - k * (box.x + box.width / 2);
  const ty = height / 2 + 15 - k * (box.y + box.height / 2);
  const t = d3.zoomIdentity.translate(tx, ty).scale(k);
  (animate ? svg.transition().duration(600) : svg).call(zoom.transform, t);
}

window.addEventListener('resize', () => state.map && fitToView(false));

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function openPerson(c, branchLabel) {
  const body = els.detailBody;
  body.innerHTML = '';
  body.append(el('p', 'kicker', branchLabel), el('h2', null, c.title), el('p', 'org', c.organization), el('p', 'why', c.why));

  if (c.talking_points?.length) {
    body.append(el('h3', null, 'Talking points'));
    const ol = el('ol');
    c.talking_points.forEach((t) => ol.append(el('li', null, t)));
    body.append(ol);
  }

  const actions = el('div', 'actions');
  const search = el('a', 'btn primary', 'Find them on LinkedIn ↗');
  search.href = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(c.search_query || c.title)}`;
  search.target = '_blank';
  search.rel = 'noopener';
  const practice = el('button', 'btn soon', 'Practice coffee chat · coming soon');
  practice.disabled = true;
  actions.append(search, practice);
  body.append(actions);

  showDetail();
}

function openBranch(b) {
  const body = els.detailBody;
  body.innerHTML = '';
  body.append(el('p', 'kicker', 'Branch'), el('h2', null, b.label), el('p', 'why', b.why));
  body.append(el('h3', null, `${b.connections.length} connections`));
  const ol = el('ol');
  b.connections.forEach((c) => ol.append(el('li', null, `${c.title}, ${c.organization}`)));
  body.append(ol);
  showDetail();
}

function showDetail() {
  const wasOpen = els.detail.classList.contains('open');
  els.detail.classList.add('open');
  els.detail.setAttribute('aria-hidden', 'false');
  els.detail.scrollTop = 0;
  if (!wasOpen) fitToView(true); // keep the map clear of the panel
}

function closeDetail() {
  const wasOpen = els.detail.classList.contains('open');
  els.detail.classList.remove('open');
  els.detail.setAttribute('aria-hidden', 'true');
  g.selectAll('.node.person').classed('active', false);
  return wasOpen;
}

// User-initiated close (× or Escape): give the map its full width back.
function dismissDetail() {
  if (closeDetail() && state.map) fitToView(true);
}
