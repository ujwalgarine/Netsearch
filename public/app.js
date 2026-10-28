// Working title shown in the header. Change it here.
const APP_NAME = 'NetPrep';
const STORE_KEY = 'netprep:v2';
const PEOPLE_PER_SEARCH = 4;

const state = {
  messages: [], // chat history sent to the planner (assistant turns are reply text only)
  map: null,    // { goal, profile, branches: [{ id, label, why, query, people, status, error, token }] }
  loading: false,
  view: null,   // what the detail panel shows: { kind, branchId?, personId? }
};

const undoStack = [];       // deep copies of state.map, newest last
const inflight = new Set(); // tokens of people searches still running

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
  undo: $('undo'),
  addBranch: $('add-branch'),
  merge: $('merge'),
  fit: $('fit'),
  reset: $('reset'),
  hint: $('drag-hint'),
  detail: $('detail'),
  detailBody: $('detail-body'),
  detailClose: $('detail-close'),
};

els.appName.textContent = APP_NAME;
document.title = `${APP_NAME} · prototype`;

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const findBranch = (id) => state.map?.branches.find((b) => b.id === id);
const allPeopleIds = () => state.map.branches.flatMap((b) => b.people.map((p) => p.id));

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

fetch('/api/status')
  .then((r) => r.json())
  .then((s) => {
    if (s.mock) {
      els.badge.hidden = false;
      els.badge.title = 'No OpenAI key found. Add it to .env and restart the server.';
    } else if (!s.people) {
      els.badge.hidden = false;
      els.badge.textContent = 'people search off';
      els.badge.title = 'Add EXA_API_KEY to .env and restart the server to find real people.';
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
els.fit.addEventListener('click', () => {
  autoFit = true;
  fitToView(true);
});
els.undo.addEventListener('click', undo);
els.addBranch.addEventListener('click', openNewBranch);
els.merge.addEventListener('click', () => openMerge([]));
els.detailClose.addEventListener('click', dismissDetail);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') dismissDetail();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) {
    e.preventDefault();
    undo();
  }
});

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
    const data = await post('/api/plan', { messages: state.messages, map: state.map && mapForServer() });
    state.messages.push({ role: 'assistant', content: data.reply });
    const searching = applyPlan(data);
    addMessage(
      'assistant',
      data.reply,
      `${data.branches.length} branches${searching ? ` · finding people for ${searching}` : ''}`,
    );
    save();
  } catch (err) {
    // Drop the failed user turn so a retry doesn't send it twice.
    if (state.messages.at(-1)?.role === 'user') state.messages.pop();
    addMessage('error', err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
    els.input.focus();
  }
}

// The planner sees the map as edited by hand, so follow-ups build on it instead of replacing it.
function mapForServer() {
  const { goal, profile, branches } = state.map;
  return {
    goal,
    profile,
    branches: branches.map((b) => ({
      id: b.id,
      label: b.label,
      why: b.why,
      query: b.query,
      people: b.people.map((p) => ({ name: p.name, headline: p.headline })),
    })),
  };
}

// Merge the planner's branch list into the map. Returns how many branches need people.
function applyPlan(data) {
  const first = !state.map;
  if (!first) snapshot();
  const prev = new Map((state.map?.branches ?? []).map((b) => [b.id, b]));
  const toLoad = [];
  const branches = data.branches.map((p) => {
    const old = p.id ? prev.get(p.id) : null;
    if (old && !p.refresh) return { ...old, label: p.label, why: p.why, query: p.query };
    const b = { id: old?.id ?? uid(), label: p.label, why: p.why, query: p.query, people: [], status: 'done', error: null, token: null };
    toLoad.push(b.id);
    return b;
  });

  state.map = { goal: data.goal, profile: data.profile, branches };
  if (first) autoFit = true;
  render({ grow: first });
  reopenDetail();
  toLoad.forEach((id) => loadPeople(id, 'replace'));
  return toLoad.length;
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
    thinkingEl.textContent = state.map ? 'Updating your branches…' : 'Planning your branches…';
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
  undoStack.length = 0;
  closeDetail();
  linkLayer.selectAll('*').remove();
  nodeLayer.selectAll('*').remove();
  updateToolbar();
  els.empty.hidden = false;
  els.mapTitle.textContent = 'Network map';
  els.messages.innerHTML = '';
  try { localStorage.removeItem(STORE_KEY); } catch {}
  addMessage('assistant', 'Fresh start. Who do you want to meet?');
}

// ---------------------------------------------------------------------------
// People search (one branch at a time)
// ---------------------------------------------------------------------------

async function loadPeople(branchId, mode) {
  const b = findBranch(branchId);
  if (!b) return;
  const token = uid();
  b.token = token;
  b.status = 'loading';
  b.error = null;
  if (mode === 'replace') b.people = [];
  inflight.add(token);
  render();
  refreshBranchPeople(branchId);

  let apply;
  try {
    const { people } = await post('/api/people', {
      goal: state.map.goal,
      profile: state.map.profile,
      branch: { label: b.label, why: b.why, query: b.query },
      exclude: allPeopleIds(), // keeps one person from showing up in two branches
      count: PEOPLE_PER_SEARCH,
    });
    apply = (br) => {
      const known = new Set(br.people.map((p) => p.id));
      const added = people.filter((p) => !known.has(p.id));
      br.people = [...br.people, ...added];
      br.status = 'done';
      br.error = added.length ? null : mode === 'more' ? 'No new matches. Try changing the search.' : 'No matches. Try a broader search.';
    };
  } catch (err) {
    apply = (br) => {
      br.status = 'error';
      br.error = err.message || 'Search failed.';
    };
  }
  inflight.delete(token);

  // Apply to the live map and any undo snapshot taken mid-search, so undo never strands a spinner.
  for (const map of [state.map, ...undoStack]) {
    const br = map?.branches.find((x) => x.id === branchId && x.token === token);
    if (br) apply(br);
  }
  save();
  render();
  refreshBranchPeople(branchId);
}

// ---------------------------------------------------------------------------
// Editing (every edit is undoable)
// ---------------------------------------------------------------------------

function snapshot() {
  if (!state.map) return;
  undoStack.push(structuredClone(state.map));
  if (undoStack.length > 50) undoStack.shift();
  updateToolbar();
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return;
  state.map = prev;
  for (const b of state.map.branches) {
    if (b.status === 'loading' && !inflight.has(b.token)) b.status = 'done';
  }
  commit();
  reopenDetail();
}

function commit() {
  save();
  render();
}

function updateGoal(goal, profile) {
  snapshot();
  Object.assign(state.map, { goal, profile });
  commit();
}

function addBranch({ label, why, query }) {
  snapshot();
  const b = { id: uid(), label, why, query, people: [], status: 'done', error: null, token: null };
  state.map.branches.push(b);
  autoFit = true;
  commit();
  loadPeople(b.id, 'replace');
  return b.id;
}

function updateBranch(id, fields) {
  snapshot();
  Object.assign(findBranch(id), fields);
  commit();
}

function deleteBranch(id) {
  snapshot();
  state.map.branches = state.map.branches.filter((b) => b.id !== id);
  commit();
}

function mergeBranches(ids, { label, query }) {
  const chosen = state.map.branches.filter((b) => ids.includes(b.id));
  if (chosen.length < 2) return null;
  snapshot();
  const people = [];
  const seen = new Set();
  for (const p of chosen.flatMap((b) => b.people)) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    people.push(p);
  }
  const merged = {
    id: uid(),
    label,
    why: [...new Set(chosen.map((b) => b.why).filter(Boolean))].join(' '),
    query,
    people,
    status: 'done',
    error: null,
    token: null,
  };
  const at = state.map.branches.indexOf(chosen[0]);
  state.map.branches = state.map.branches.filter((b) => !ids.includes(b.id));
  state.map.branches.splice(at, 0, merged);
  commit();
  return merged.id;
}

function removePerson(branchId, personId) {
  snapshot();
  const b = findBranch(branchId);
  b.people = b.people.filter((p) => p.id !== personId);
  commit();
}

function movePerson(fromId, personId, toId) {
  const from = findBranch(fromId);
  const to = findBranch(toId);
  const person = from?.people.find((p) => p.id === personId);
  if (!person || !to || from === to) return;
  snapshot();
  from.people = from.people.filter((p) => p.id !== personId);
  to.people.push(person);
  to.error = null;
  commit();
  if (state.view?.personId === personId) state.view.branchId = toId;
  reopenDetail();
}

// ---------------------------------------------------------------------------
// Saving (this browser only)
// ---------------------------------------------------------------------------

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ messages: state.messages, map: state.map }));
  } catch {}
}

function restore() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY));
  } catch {}
  if (!Array.isArray(saved?.map?.branches)) return;

  state.messages = Array.isArray(saved.messages) ? saved.messages : [];
  state.map = saved.map;
  for (const b of state.map.branches) {
    if (b.status === 'loading') {
      b.status = 'error';
      b.error = 'Search was interrupted. Open the branch to search again.';
    }
  }
  document.querySelector('.intro')?.remove();
  state.messages.forEach((m) => addMessage(m.role === 'user' ? 'user' : 'assistant', m.content));
  addMessage('assistant', 'Picked up where you left off.', 'saved in this browser');
  autoFit = true;
  render({ grow: true });
}

// ---------------------------------------------------------------------------
// Map (D3 tidy tree: goal -> branches -> people)
// ---------------------------------------------------------------------------

const svg = d3.select('#graph');
const g = svg.append('g');
const linkLayer = g.append('g');
const nodeLayer = g.append('g');
let autoFit = true; // keep the whole map in view as it grows, until the user pans or zooms
let lastRoot = null;

const zoom = d3
  .zoom()
  .scaleExtent([0.25, 2.5])
  .on('zoom', (e) => {
    g.attr('transform', e.transform);
    if (e.sourceEvent) autoFit = false;
  });
svg.call(zoom).on('dblclick.zoom', null);

const CARD_W = 236;
const CARD_H = 44;
const STAGE = 450; // ms between tree levels growing in
const MOVE = 420;  // ms for nodes sliding into new positions after an edit

const truncate = (s = '', n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sibIndex = (d) => (d.parent ? d.parent.children.indexOf(d) : 0);
const delayFor = (d) => (d.depth === 0 ? 0 : (d.depth - 1) * STAGE + sibIndex(d) * 70);
const pos = (d) => `translate(${d.y},${d.x})`;
const linkPath = d3.linkHorizontal().x((d) => d.y).y((d) => d.x);

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

function statusText(b) {
  if (b.status === 'loading') return b.people.length ? 'Finding more people…' : 'Searching for people…';
  return b.error || 'No people yet · open to search';
}

function buildTree(map) {
  return d3.hierarchy({
    id: 'root',
    kind: 'root',
    children: [
      ...map.branches.map((b) => {
        const children = b.people.map((p) => ({ id: `${b.id}|${p.id}`, kind: 'person', b, p }));
        if (b.status === 'loading' || b.error || !b.people.length) {
          children.push({ id: `${b.id}|status`, kind: 'status', b });
        }
        return { id: b.id, kind: 'branch', b, children };
      }),
      { id: 'add', kind: 'add' },
    ],
  });
}

function render({ grow = false } = {}) {
  if (!state.map) return;
  els.empty.hidden = true;
  els.mapTitle.textContent = `Network map · ${state.map.goal}`;
  updateToolbar();

  const root = buildTree(state.map);
  d3.tree()
    .nodeSize([CARD_H + 16, 290])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.5))(root);
  lastRoot = root;

  if (grow) {
    linkLayer.selectAll('*').remove();
    nodeLayer.selectAll('*').remove();
  }

  // Links. On a new map they draw themselves in, level by level; after edits they slide.
  linkLayer
    .selectAll('path:not(.exiting)')
    .data(root.links(), (d) => d.target.data.id)
    .join(
      (enter) =>
        enter
          .append('path')
          .attr('d', linkPath)
          .each(function (d) {
            const path = d3.select(this);
            if (!grow) {
              path.style('opacity', 0).transition('fade').delay(MOVE / 2).duration(300).style('opacity', 1);
              return;
            }
            const len = this.getTotalLength();
            path
              .attr('stroke-dasharray', len)
              .attr('stroke-dashoffset', len)
              .transition('fade')
              .delay(delayFor(d.target))
              .duration(650)
              .ease(d3.easeCubicOut)
              .attr('stroke-dashoffset', 0)
              .on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
          }),
      (update) => update.call((p) => p.transition('move').duration(MOVE).attr('d', linkPath)),
      (exit) => fadeOut(exit),
    )
    .attr('class', (d) => `link depth-${d.target.depth} to-${d.target.data.kind}`);

  const nodes = nodeLayer
    .selectAll('g.node:not(.exiting)')
    .data(root.descendants(), (d) => d.data.id)
    .join(
      (enter) =>
        enter
          .append('g')
          .attr('transform', pos)
          .style('opacity', 0)
          .call((s) =>
            s
              .transition('fade')
              .delay((d) => (grow ? (d.depth === 0 ? 0 : delayFor(d) + 380) : MOVE / 2))
              .duration(grow ? 380 : 300)
              .style('opacity', 1),
          ),
      (update) => update.call((s) => s.transition('move').duration(MOVE).attr('transform', pos).style('opacity', 1)),
      (exit) => fadeOut(exit),
    )
    .attr('class', (d) => `node ${d.data.kind}${d.data.kind === 'status' ? ` ${d.data.b.status}` : ''}`);

  nodes.each(function (d) { drawNode(d3.select(this), d); });
  markActive();

  if (autoFit) fitToView(!grow);
}

// transition.remove() skips elements with other transitions still running, so stop those first.
function fadeOut(exit) {
  return exit.classed('exiting', true).interrupt('move').interrupt('fade').transition('fade').duration(200).style('opacity', 0).remove();
}

function drawNode(n, d) {
  n.selectAll('*').remove();
  n.on('click', null).on('.drag', null);
  const { kind } = d.data;

  if (kind === 'root') {
    n.append('circle').attr('class', 'halo').attr('r', 15);
    n.append('circle').attr('r', 7);
    const text = n.append('text').attr('text-anchor', 'end').attr('x', -26);
    const lines = wrap(state.map.goal, 22);
    lines.forEach((l, i) =>
      text
        .append('tspan')
        .attr('x', -26)
        .attr('dy', i === 0 ? `${0.35 - (lines.length - 1) * 0.55}em` : '1.1em')
        .text(l),
    );
    n.append('title').text('Edit your goal and background');
    n.on('click', openGoal);
  } else if (kind === 'branch') {
    const { b } = d.data;
    n.append('circle').attr('class', 'drop-ring').attr('r', 22);
    n.append('rect').attr('x', -5).attr('y', -5).attr('width', 10).attr('height', 10).attr('transform', 'rotate(45)');
    n.append('text').attr('x', 0).attr('y', -14).attr('text-anchor', 'middle').text(truncate(b.label, 34));
    n.append('title').text(`${b.label}: click to edit, drag onto another branch to merge`);
    n.on('click', () => openBranch(b.id));
    n.call(drag);
  } else if (kind === 'person') {
    const { p, b } = d.data;
    n.append('rect').attr('class', 'card').attr('x', 0).attr('y', -CARD_H / 2).attr('width', CARD_W).attr('height', CARD_H).attr('rx', 5);
    n.append('rect').attr('class', 'bar').attr('x', 0).attr('y', -CARD_H / 2).attr('width', 3).attr('height', CARD_H).attr('rx', 1.5);
    n.append('text').attr('class', 'title').attr('x', 14).attr('y', -3).text(truncate(p.name, 31));
    n.append('text').attr('class', 'org').attr('x', 14).attr('y', 13).text(truncate(p.headline, 36));
    n.append('title').text(`${p.name}, ${p.headline}\nDrag onto another branch to move`);
    n.on('click', () => openPerson(b.id, p.id));
    n.call(drag);
  } else if (kind === 'status') {
    const { b } = d.data;
    n.append('circle').attr('class', 'dot').attr('cx', 6).attr('r', 3.5);
    n.append('text').attr('x', 18).attr('y', 4).text(truncate(statusText(b), 44));
    n.append('title').text(statusText(b));
    n.on('click', () => openBranch(b.id));
  } else if (kind === 'add') {
    n.append('rect').attr('x', -62).attr('y', -13).attr('width', 124).attr('height', 26).attr('rx', 13);
    n.append('text').attr('text-anchor', 'middle').attr('y', 4).text('+ New branch');
    n.on('click', openNewBranch);
  }
}

function markActive() {
  const v = state.view;
  nodeLayer.selectAll('g.node').classed('active', (d) => {
    if (!v) return false;
    if (v.kind === 'person') return d.data.kind === 'person' && d.data.b.id === v.branchId && d.data.p.id === v.personId;
    if (v.kind === 'branch') return d.data.kind === 'branch' && d.data.id === v.branchId;
    if (v.kind === 'goal') return d.data.kind === 'root';
    return false;
  });
}

// Drag a branch onto another branch to merge them; drag a person onto a branch to move them.
const drag = d3
  .drag()
  .clickDistance(5)
  .subject((_e, d) => ({ x: d.y, y: d.x }))
  .on('start', (_e, d) => { d.dragging = false; })
  .on('drag', function (e, d) {
    if (!d.dragging) {
      d.dragging = true;
      d3.select(this).raise().classed('dragging', true);
      els.hint.textContent = d.data.kind === 'branch' ? 'Drop on another branch to merge' : 'Drop on a branch to move this person';
      els.hint.hidden = false;
    }
    d3.select(this).interrupt('move').attr('transform', `translate(${e.x},${e.y})`);
    setDropTarget(dropTarget(d, ...d3.pointer(e, nodeLayer.node())));
  })
  .on('end', function (e, d) {
    if (!d.dragging) return;
    d.dragging = false;
    const target = dropTarget(d, ...d3.pointer(e, nodeLayer.node()));
    setDropTarget(null);
    els.hint.hidden = true;
    d3.select(this).classed('dragging', false).transition('move').duration(250).attr('transform', pos(d));
    if (!target) return;
    if (d.data.kind === 'branch') openMerge([d.data.id, target]);
    else movePerson(d.data.b.id, d.data.p.id, target);
  });

// Which branch (other than the dragged node's own) is under the pointer, if any.
function dropTarget(d, px, py) {
  const own = d.data.kind === 'branch' ? d.data.id : d.data.b.id;
  for (const n of lastRoot.descendants()) {
    const b = n.data.b;
    if (!b || b.id === own) continue;
    if (n.data.kind === 'branch' && Math.hypot(px - n.y, py - n.x) < 40) return b.id;
    if (
      (n.data.kind === 'person' || n.data.kind === 'status') &&
      px > n.y - 10 && px < n.y + CARD_W + 10 &&
      py > n.x - CARD_H / 2 - 6 && py < n.x + CARD_H / 2 + 6
    ) return b.id;
  }
  return null;
}

function setDropTarget(id) {
  nodeLayer.selectAll('g.node.branch').classed('drop-target', (n) => n.data.id === id);
}

// Fit using the layout's extents, so it is right even while nodes are mid-transition.
function fitToView(animate) {
  if (!lastRoot) return;
  const extent = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const n of lastRoot.descendants()) {
    const k = n.data.kind;
    extent.left = Math.min(extent.left, n.y - (k === 'root' ? 230 : k === 'branch' ? 120 : 0));
    extent.right = Math.max(extent.right, n.y + (k === 'person' || k === 'status' ? CARD_W : 120));
    extent.top = Math.min(extent.top, n.x - (k === 'branch' ? 30 : CARD_H / 2));
    extent.bottom = Math.max(extent.bottom, n.x + CARD_H / 2);
  }
  const box = { x: extent.left, y: extent.top, width: extent.right - extent.left, height: extent.bottom - extent.top };

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
  (animate ? svg.transition('fit').duration(600) : svg).call(zoom.transform, t);
}

window.addEventListener('resize', () => state.map && autoFit && fitToView(false));

// The map clips its overflow, but the browser can still scroll it to reveal a focused
// element in the sliding panel, which would shift the toolbar and map. Pin it in place.
const mapEl = document.querySelector('.map');
mapEl.addEventListener('scroll', () => {
  mapEl.scrollLeft = 0;
  mapEl.scrollTop = 0;
});

function updateToolbar() {
  const has = Boolean(state.map);
  els.fit.disabled = !has;
  els.reset.disabled = !has;
  els.addBranch.disabled = !has;
  els.merge.disabled = !has || state.map.branches.length < 2;
  els.undo.disabled = !undoStack.length;
}

// ---------------------------------------------------------------------------
// Detail panel: person details and the branch / goal / merge editors
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(text, cls, onClick) {
  const b = el('button', `btn ${cls}`, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function field(label, control, hint) {
  const wrapEl = el('label', 'field');
  wrapEl.append(el('span', 'field-label', label), control);
  if (hint) wrapEl.append(el('span', 'field-hint', hint));
  return wrapEl;
}

function input(value, placeholder) {
  const i = el('input');
  i.type = 'text';
  i.value = value ?? '';
  if (placeholder) i.placeholder = placeholder;
  return i;
}

function textarea(value, placeholder, rows = 3) {
  const t = el('textarea');
  t.value = value ?? '';
  t.rows = rows;
  if (placeholder) t.placeholder = placeholder;
  return t;
}

function openView(view) {
  state.view = view;
  els.detailBody.innerHTML = '';
  markActive();
  return els.detailBody;
}

// After undo, merges, or chat updates: re-show the current view if it still exists.
function reopenDetail() {
  const v = state.view;
  if (!v || !els.detail.classList.contains('open')) return;
  if (v.kind === 'person' && findBranch(v.branchId)?.people.some((p) => p.id === v.personId)) openPerson(v.branchId, v.personId);
  else if (v.kind === 'branch' && findBranch(v.branchId)) openBranch(v.branchId);
  else if (v.kind === 'goal') openGoal();
  else if (v.kind !== 'new' && v.kind !== 'merge') dismissDetail();
}

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function profileLink(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    return { label: /linkedin\.com$/.test(host) ? 'View LinkedIn profile ↗' : `Open profile on ${host} ↗`, short: host + u.pathname.replace(/\/$/, '') };
  } catch {
    return null;
  }
}

const fmtDates = (x) => [x.from, x.to ?? (x.from ? 'present' : null)].filter(Boolean).join(' – ');

function openPerson(branchId, personId) {
  const b = findBranch(branchId);
  const p = b?.people.find((x) => x.id === personId);
  if (!p) return dismissDetail();
  const body = openView({ kind: 'person', branchId, personId });

  const head = el('div', 'person-head');
  const avatar = el('div', 'avatar', initials(p.name));
  if (p.image) {
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = p.image;
    img.onload = () => { avatar.textContent = ''; avatar.append(img); };
  }
  const who = el('div');
  who.append(el('h2', null, p.name), el('p', 'org', [p.headline, p.location].filter(Boolean).join(' · ')));
  head.append(avatar, who);
  body.append(el('p', 'kicker', b.label), head);

  const link = p.url && profileLink(p.url);
  if (link) {
    const a = el('a', 'btn primary', link.label);
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    body.append(a, el('p', 'link-url', link.short));
  }

  if (p.summary) body.append(el('h3', null, 'About'), el('p', 'why', p.summary));
  if (p.why) body.append(el('h3', null, 'Why reach out'), el('p', 'why', p.why));

  if (p.in_common?.length) {
    body.append(el('h3', null, 'In common'));
    const tags = el('div', 'tags');
    p.in_common.forEach((t) => tags.append(el('span', 'tag-pill', t)));
    body.append(tags);
  }

  if (p.talking_points?.length) {
    body.append(el('h3', null, 'Talking points'));
    const ol = el('ol');
    p.talking_points.forEach((t) => ol.append(el('li', null, t)));
    body.append(ol);
  }

  if (p.experience?.length) {
    body.append(el('h3', null, 'Experience'));
    const ul = el('ul', 'facts');
    p.experience.forEach((x) => {
      const li = el('li');
      li.append(el('span', null, [x.title, x.company].filter(Boolean).join(' · ')), el('span', 'dates', fmtDates(x)));
      ul.append(li);
    });
    body.append(ul);
  }

  if (p.education?.length) {
    body.append(el('h3', null, 'Education'));
    const ul = el('ul', 'facts');
    p.education.forEach((x) => {
      const li = el('li');
      li.append(el('span', null, [x.degree, x.school].filter(Boolean).join(' · ')), el('span', 'dates', fmtDates(x)));
      ul.append(li);
    });
    body.append(ul);
  }

  const others = state.map.branches.filter((x) => x.id !== branchId);
  const actions = el('div', 'actions');
  if (others.length) {
    const select = el('select');
    select.append(el('option', null, 'Move to branch…'));
    others.forEach((o) => {
      const opt = el('option', null, o.label);
      opt.value = o.id;
      select.append(opt);
    });
    select.firstChild.value = '';
    select.addEventListener('change', () => select.value && movePerson(branchId, personId, select.value));
    actions.append(select);
  }
  actions.append(button('Remove from map', 'quiet danger', () => {
    removePerson(branchId, personId);
    openBranch(branchId);
  }));
  const practice = button('Practice coffee chat · coming soon', 'soon', () => {});
  practice.disabled = true;
  actions.append(practice);
  body.append(actions);

  showDetail();
}

function openBranch(id) {
  const b = findBranch(id);
  if (!b) return dismissDetail();
  const body = openView({ kind: 'branch', branchId: id });
  body.append(el('p', 'kicker', 'Branch'));

  const name = input(b.label, 'e.g. UW alumni at Microsoft');
  name.className = 'title-input';
  const why = textarea(b.why, 'Why this group matters for your goal', 2);
  const query = textarea(b.query, 'e.g. product managers at Microsoft who studied at the University of Washington', 3);
  const form = el('form', 'editor');
  form.append(
    field('Name', name),
    field('Why it matters', why),
    field('Who to find', query, 'Plain English. This is what people search looks for.'),
  );

  const saveRow = el('div', 'row');
  const saveBtn = button('Save changes', 'primary', () => saveEdits(false));
  const searchBtn = button('Save & search again', 'secondary', () => saveEdits(true));
  saveRow.append(saveBtn, searchBtn);
  form.append(saveRow);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveEdits(false);
  });
  body.append(form);

  function saveEdits(research) {
    const fields = { label: name.value.trim() || b.label, why: why.value.trim(), query: query.value.trim() };
    const changed = fields.label !== b.label || fields.why !== b.why || fields.query !== b.query;
    if (changed) updateBranch(id, fields);
    else if (research) snapshot();
    if (research) loadPeople(id, 'replace');
    flash(saveBtn, research ? 'Searching…' : changed ? 'Saved' : 'No changes');
  }

  body.append(el('div', 'branch-people'));
  refreshBranchPeople(id);

  const more = el('div', 'actions');
  if (state.map.branches.length > 1) {
    more.append(button('Merge with another branch…', 'secondary', () => openMerge([id])));
  }
  const del = button('Delete branch', 'quiet danger', () => {
    const confirm = confirmRow(
      `Delete "${b.label}" and its ${b.people.length} people?`,
      'Delete',
      () => {
        deleteBranch(id);
        dismissDetail();
      },
      () => confirm.replaceWith(del),
    );
    del.replaceWith(confirm);
  });
  more.append(del);
  body.append(more);

  showDetail();
}

// The people list inside the branch editor updates on its own, so a finished search
// doesn't wipe out edits being typed into the form above it.
function refreshBranchPeople(id) {
  if (state.view?.kind !== 'branch' || state.view.branchId !== id) return;
  const box = els.detailBody.querySelector('.branch-people');
  const b = findBranch(id);
  if (!box || !b) return;
  box.innerHTML = '';

  box.append(el('h3', null, `${b.people.length} ${b.people.length === 1 ? 'person' : 'people'}`));
  const ul = el('ul', 'people-list');
  b.people.forEach((p) => {
    const li = el('li');
    const open = button('', 'person-link', () => openPerson(id, p.id));
    open.append(el('span', 'pl-name', p.name), el('span', 'pl-head', p.headline));
    const remove = button('×', 'icon', () => removePerson(id, p.id));
    remove.title = `Remove ${p.name}`;
    remove.setAttribute('aria-label', `Remove ${p.name}`);
    li.append(open, remove);
    ul.append(li);
  });
  box.append(ul);

  if (b.status === 'loading' || b.error) {
    box.append(el('p', `status-line ${b.status}`, statusText(b)));
  }

  const row = el('div', 'row');
  const busy = b.status === 'loading';
  const moreBtn = button(`Find ${PEOPLE_PER_SEARCH} more`, 'secondary', () => loadPeople(id, 'more'));
  moreBtn.disabled = busy || !b.people.length;
  const againBtn = button('Search again', 'secondary', () => {
    snapshot();
    loadPeople(id, 'replace');
  });
  againBtn.disabled = busy;
  row.append(moreBtn, againBtn);
  box.append(row);
}

function openGoal() {
  const body = openView({ kind: 'goal' });
  body.append(el('p', 'kicker', 'Goal'));
  const goal = input(state.map.goal);
  goal.className = 'title-input';
  const profile = textarea(state.map.profile, 'School, major, year, where you live, past jobs, clubs, interests…', 4);
  const form = el('form', 'editor');
  form.append(
    field('What you want', goal),
    field('About you', profile, 'Used to find shared ties and write talking points. Applies to new searches.'),
  );
  const saveBtn = button('Save', 'primary', saveGoal);
  const row = el('div', 'row');
  row.append(saveBtn);
  form.append(row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveGoal();
  });
  body.append(form);

  function saveGoal() {
    const newGoal = goal.value.trim() || state.map.goal;
    const newProfile = profile.value.trim();
    if (newGoal === state.map.goal && newProfile === state.map.profile) return flash(saveBtn, 'No changes');
    updateGoal(newGoal, newProfile);
    flash(saveBtn, 'Saved');
  }
  showDetail();
}

function openNewBranch() {
  if (!state.map) return;
  const body = openView({ kind: 'new' });
  body.append(el('p', 'kicker', 'New branch'), el('h2', null, 'Add a group of people'));

  const name = input('', 'e.g. Climate tech founders in Seattle');
  const query = textarea('', 'e.g. founders of climate tech startups in Seattle who studied at UW', 3);
  const why = textarea('', 'Optional', 2);
  const form = el('form', 'editor');
  form.append(
    field('Name', name),
    field('Who to find', query, 'Plain English. Leave blank to search by the name.'),
    field('Why it matters', why),
  );
  const create = button('Create & find people', 'primary', submitNew);
  const row = el('div', 'row');
  row.append(create);
  form.append(row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitNew();
  });
  body.append(form);

  function submitNew() {
    const label = name.value.trim();
    if (!label) {
      name.focus({ preventScroll: true });
      return flash(create, 'Name it first');
    }
    const id = addBranch({
      label,
      why: why.value.trim(),
      query: query.value.trim() || `professional profiles of ${label}`,
    });
    openBranch(id);
  }
  showDetail();
  name.focus({ preventScroll: true });
}

function openMerge(preselected) {
  if (!state.map || state.map.branches.length < 2) return;
  const body = openView({ kind: 'merge' });
  body.append(el('p', 'kicker', 'Merge branches'), el('h2', null, 'Combine branches'));
  body.append(el('p', 'why', 'People are combined and duplicates removed. Pick at least two.'));

  const picked = new Set(preselected);
  const list = el('ul', 'check-list');
  const name = input('');
  const query = textarea('', null, 3);
  let nameEdited = false;
  let queryEdited = false;
  name.addEventListener('input', () => { nameEdited = true; });
  query.addEventListener('input', () => { queryEdited = true; });

  const go = button('', 'primary', () => {
    const ids = state.map.branches.filter((b) => picked.has(b.id)).map((b) => b.id);
    const mergedId = mergeBranches(ids, { label: name.value.trim() || defaultName(), query: query.value.trim() });
    if (mergedId) openBranch(mergedId);
  });

  const chosen = () => state.map.branches.filter((b) => picked.has(b.id));
  const defaultName = () => chosen().map((b) => b.label).join(' + ');

  function sync() {
    if (!nameEdited) name.value = defaultName();
    if (!queryEdited) query.value = chosen()[0]?.query ?? '';
    go.textContent = picked.size >= 2 ? `Merge ${picked.size} branches` : 'Pick at least two';
    go.disabled = picked.size < 2;
  }

  state.map.branches.forEach((b) => {
    const li = el('li');
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = picked.has(b.id);
    box.addEventListener('change', () => {
      box.checked ? picked.add(b.id) : picked.delete(b.id);
      sync();
    });
    label.append(box, el('span', null, b.label), el('span', 'count', String(b.people.length)));
    li.append(label);
    list.append(li);
  });

  const form = el('form', 'editor');
  form.append(list, field('Merged name', name), field('Who to find', query, 'Used by "Find more" in the merged branch.'));
  const row = el('div', 'row');
  row.append(go);
  form.append(row);
  form.addEventListener('submit', (e) => e.preventDefault());
  body.append(form);
  sync();
  showDetail();
}

function confirmRow(message, action, onConfirm, onCancel) {
  const box = el('div', 'confirm');
  box.append(el('p', null, message));
  const row = el('div', 'row');
  row.append(button(action, 'danger-solid', onConfirm), button('Cancel', 'secondary', onCancel));
  box.append(row);
  return box;
}

function flash(btn, text) {
  const original = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  clearTimeout(btn.__t);
  btn.__t = setTimeout(() => { btn.textContent = original; }, 1400);
}

function showDetail() {
  const wasOpen = els.detail.classList.contains('open');
  els.detail.classList.add('open');
  els.detail.setAttribute('aria-hidden', 'false');
  els.detail.inert = false;
  els.detail.scrollTop = 0;
  if (!wasOpen && autoFit) fitToView(true); // keep the map clear of the panel
}

function closeDetail() {
  const wasOpen = els.detail.classList.contains('open');
  els.detail.classList.remove('open');
  els.detail.setAttribute('aria-hidden', 'true');
  els.detail.inert = true;
  state.view = null;
  markActive();
  return wasOpen;
}

// User-initiated close (× or Escape): give the map its full width back.
function dismissDetail() {
  if (closeDetail() && state.map && autoFit) fitToView(true);
}

restore();
