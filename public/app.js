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
  mapCount: $('map-count'),
  undo: $('undo'),
  addBranch: $('add-branch'),
  merge: $('merge'),
  fit: $('fit'),
  reset: $('reset'),
  hint: $('drag-hint'),
  detail: $('detail'),
  detailBody: $('detail-body'),
  detailClose: $('detail-close'),
  workspace: document.querySelector('.workspace'),
  chatToggle: $('chat-toggle'),
  chatRail: $('chat-rail'),
  chatUnread: $('chat-unread'),
  showEarlier: $('show-earlier'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  toast: $('toast'),
};

els.appName.textContent = APP_NAME;
document.title = APP_NAME;

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
      els.badge.textContent = 'People search off';
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
els.zoomIn.addEventListener('click', () => zoomBy(1.25));
els.zoomOut.addEventListener('click', () => zoomBy(0.8));
els.undo.addEventListener('click', undo);
els.addBranch.addEventListener('click', openNewBranch);
els.merge.addEventListener('click', () => openMerge([]));
els.detailClose.addEventListener('click', dismissDetail);
els.chatToggle.addEventListener('click', () => setChatCollapsed(!chatCollapsed));
els.chatRail.addEventListener('click', () => setChatCollapsed(false));
els.showEarlier.addEventListener('click', () => {
  historyExpanded = true;
  compactHistory();
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    if (closeMenus()) return;
    dismissDetail();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !typing) {
    e.preventDefault();
    undo();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '\\') {
    e.preventDefault();
    setChatCollapsed(!chatCollapsed);
  }
  // Step through people while a person is open (unless a map node has focus; arrows collapse branches there).
  const onNode = document.activeElement?.closest?.('#graph');
  if (state.view?.kind === 'person' && !onNode && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    stepPerson(e.key === 'ArrowRight' ? 1 : -1);
  }
});

// Close any open overflow menu when clicking elsewhere.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.menu[open]').forEach((m) => !m.contains(e.target) && m.removeAttribute('open'));
});

function closeMenus() {
  const open = [...document.querySelectorAll('details.menu[open]')];
  open.forEach((m) => m.removeAttribute('open'));
  return open.length > 0;
}

// ---------------------------------------------------------------------------
// Chat panel: collapsible, with older history folded away
// ---------------------------------------------------------------------------

const CHAT_KEY = 'netprep:chat-collapsed';
const VISIBLE_MESSAGES = 4; // the latest exchange or two stay visible; older ones fold
let chatCollapsed = false;
let historyExpanded = false;

function setChatCollapsed(on) {
  chatCollapsed = on;
  els.workspace.classList.toggle('chat-collapsed', on);
  els.chatToggle.setAttribute('aria-expanded', String(!on));
  els.chatToggle.setAttribute('aria-label', on ? 'Show chat' : 'Hide chat');
  els.chatToggle.title = `${on ? 'Show' : 'Hide'} chat (\\)`;
  if (!on) els.chatUnread.hidden = true;
  try { localStorage.setItem(CHAT_KEY, on ? '1' : '0'); } catch {}
}

function compactHistory() {
  const msgs = [...els.messages.querySelectorAll('.msg')];
  const hide = historyExpanded ? 0 : Math.max(0, msgs.length - VISIBLE_MESSAGES);
  msgs.forEach((m, i) => { m.hidden = i < hide; });
  els.showEarlier.hidden = hide === 0;
  els.showEarlier.textContent = `Show ${hide} earlier ${hide === 1 ? 'message' : 'messages'}`;
}

try { setChatCollapsed(localStorage.getItem(CHAT_KEY) === '1'); } catch {}

// ---------------------------------------------------------------------------
// Toast with undo: every destructive edit can be taken back from right here
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(message, { undoable = false } = {}) {
  clearTimeout(toastTimer);
  els.toast.innerHTML = '';
  els.toast.append(el('span', null, message));
  if (undoable) {
    els.toast.append(button('Undo', 'toast-action', () => {
      undo();
      els.toast.hidden = true;
    }));
  }
  els.toast.hidden = false;
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, undoable ? 6000 : 2400);
}

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
  if (kind === 'assistant') {
    els.messages.querySelectorAll('.msg.latest').forEach((m) => m.classList.remove('latest'));
    div.classList.add('latest');
    if (chatCollapsed) els.chatUnread.hidden = false;
  }
  els.messages.appendChild(div);
  compactHistory();
  els.messages.scrollTop = els.messages.scrollHeight;
}

let thinkingEl = null;
function setLoading(on) {
  state.loading = on;
  els.send.disabled = on;
  if (on) {
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking';
    thinkingEl.innerHTML = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    thinkingEl.append(el('span', 'label', state.map ? 'Updating your branches' : 'Mapping your network'));
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
  els.mapTitle.textContent = 'No map yet';
  particleLayer.selectAll('*').remove();
  els.messages.innerHTML = '';
  historyExpanded = false;
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
  const b = findBranch(id);
  snapshot();
  state.map.branches = state.map.branches.filter((x) => x.id !== id);
  commit();
  toast(`Deleted "${b.label}"`, { undoable: true });
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
  toast(`Merged ${chosen.length} branches`, { undoable: true });
  return merged.id;
}

function removePerson(branchId, personId) {
  snapshot();
  const b = findBranch(branchId);
  const person = b.people.find((p) => p.id === personId);
  b.people = b.people.filter((p) => p.id !== personId);
  commit();
  toast(`Removed ${person?.name ?? 'person'}`, { undoable: true });
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
  to.collapsed = false;
  commit();
  toast(`Moved ${person.name} to ${to.label}`, { undoable: true });
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
  toast('Restored your saved map');
  autoFit = true;
  render({ grow: true });
}

// ---------------------------------------------------------------------------
// Map (D3 tidy tree: goal -> branches -> people)
// ---------------------------------------------------------------------------

const svg = d3.select('#graph');
const defs = svg.append('defs');
const glow = defs.append('radialGradient').attr('id', 'root-glow');
glow.append('stop').attr('offset', '0%').attr('stop-color', '#4a5a22').attr('stop-opacity', 0.5);
glow.append('stop').attr('offset', '100%').attr('stop-color', '#4a5a22').attr('stop-opacity', 0);

const g = svg.append('g');
const glowLayer = g.append('g').attr('class', 'root-glow'); // moss light behind the root, moves with the map
const linkLayer = g.append('g');
const particleLayer = g.append('g');
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

if (window.DotField) window.DotField(document.getElementById('field'), { crest: 0.72, rest: 0.07 });

const CARD_W = 240;
const CARD_H = 50;
const PILL_H = 30;
const COL = 340;   // horizontal distance between tree levels
const STAGE = 450; // ms between tree levels growing in
const MOVE = 420;  // ms for nodes sliding into new positions after an edit
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const truncate = (s = '', n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const sibIndex = (d) => (d.parent ? d.parent.children.indexOf(d) : 0);
const delayFor = (d) => (d.depth === 0 ? 0 : (d.depth - 1) * STAGE + sibIndex(d) * 60);
const pos = (d) => `translate(${d.y},${d.x})`;
// Branch pills are as wide as their label (Geist Mono 11px + tracking is about 7.9px per character).
const pillWidth = (label) => Math.round(Math.min(label.length, 26) * 7.9 + 92); // + room for the collapse toggle

// Links leave from the right edge of a pill and arrive at the left edge of the next node.
function linkPath(l) {
  const sx = l.source.y + (l.source.data.w || 0);
  const sy = l.source.x;
  const tx = l.target.y;
  const ty = l.target.x;
  const mx = (sx + tx) / 2;
  return `M${sx},${sy}C${mx},${sy} ${mx},${ty} ${tx},${ty}`;
}

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
  return b.error || 'No people yet. Open to search.';
}

function buildTree(map) {
  return d3.hierarchy({
    id: 'root',
    kind: 'root',
    children: [
      ...map.branches.map((b) => {
        const children = b.collapsed ? [] : b.people.map((p) => ({ id: `${b.id}|${p.id}`, kind: 'person', b, p }));
        if (!b.collapsed && (b.status === 'loading' || b.error || !b.people.length)) {
          children.push({ id: `${b.id}|status`, kind: 'status', b });
        }
        return { id: b.id, kind: 'branch', b, w: pillWidth(b.label), children };
      }),
      { id: 'add', kind: 'add', w: 140 },
    ],
  });
}

function render({ grow = false } = {}) {
  if (!state.map) return;
  els.empty.hidden = true;
  els.mapTitle.textContent = state.map.goal;
  updateToolbar();
  const staged = grow && !reduceMotion.matches;

  const root = buildTree(state.map);
  d3.tree()
    .nodeSize([CARD_H + 12, COL])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.4))(root);
  lastRoot = root;

  if (grow) {
    linkLayer.selectAll('*').remove();
    nodeLayer.selectAll('*').remove();
  }

  glowLayer
    .selectAll('circle')
    .data([root])
    .join('circle')
    .attr('r', 420)
    .attr('fill', 'url(#root-glow)')
    .attr('cx', (d) => d.y)
    .attr('cy', (d) => d.x);

  // Links: dotted light. On a new map they reveal left to right, level by level
  // (dotted strokes can't use the dashoffset trick); after edits they slide.
  linkLayer
    .selectAll('path:not(.exiting)')
    .data(root.links(), (d) => d.target.data.id)
    .join(
      (enter) =>
        enter
          .append('path')
          .attr('d', linkPath)
          .property('__d', linkPath)
          .each(function (d) {
            const path = d3.select(this);
            if (!staged) {
              path.attr('opacity', 0).transition('fade').delay(grow ? 0 : MOVE / 2).duration(300).attr('opacity', 1);
              return;
            }
            path
              .style('clip-path', 'inset(0% 100% 0% 0%)')
              .transition('fade')
              .delay(delayFor(d.target))
              .duration(700)
              .ease(d3.easeCubicOut)
              .style('clip-path', 'inset(0% 0% 0% 0%)')
              .on('end', function () { d3.select(this).style('clip-path', null); });
          }),
      (update) =>
        update.each(function (d) {
          const next = linkPath(d);
          if (this.__d === next) return;
          this.__d = next;
          d3.select(this).transition('move').duration(MOVE).attr('d', next);
        }),
      (exit) => fadeOut(exit),
    )
    .attr('class', (d) => `link depth-${d.target.depth} to-${d.target.data.kind}`);

  // Nodes only move when their position changes, so a re-render mid-animation
  // (e.g. a search finishing) doesn't cut the grow-in short.
  const nodes = nodeLayer
    .selectAll('g.node:not(.exiting)')
    .data(root.descendants(), (d) => d.data.id)
    .join(
      (enter) =>
        enter
          .append('g')
          .property('__pos', pos)
          .attr('transform', (d) => (staged && d.depth ? `translate(${d.y},${d.x + 6})` : pos(d)))
          .style('opacity', 0)
          .call((s) =>
            s
              .transition('fade')
              .delay((d) => (staged ? (d.depth === 0 ? 0 : delayFor(d) + 420) : grow ? 0 : MOVE / 2))
              .duration(staged ? 420 : 300)
              .ease(d3.easeCubicOut)
              .attr('transform', pos)
              .style('opacity', 1),
          ),
      (update) =>
        update.each(function (d) {
          const next = pos(d);
          if (this.__pos === next) return;
          this.__pos = next;
          d3.select(this).interrupt('fade').style('opacity', 1).transition('move').duration(MOVE).attr('transform', next);
        }),
      (exit) => fadeOut(exit),
    )
    .attr('class', (d) => `node ${d.data.kind}${d.data.kind === 'status' ? ` ${d.data.b.status}` : ''}${d.data.kind === 'branch' && d.data.b.collapsed ? ' collapsed' : ''}`)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', ariaLabel)
    .order(); // keep Tab order: goal, branches, then people

  nodes.each(function (d) { drawNode(d3.select(this), d); });
  markActive();

  if (autoFit) fitToView(!grow);
}

// transition.remove() skips elements with other transitions still running, so stop those first.
function fadeOut(exit) {
  return exit
    .classed('exiting', true)
    .attr('tabindex', null)
    .interrupt('move')
    .interrupt('fade')
    .transition('fade')
    .duration(200)
    .style('opacity', 0)
    .remove();
}

function ariaLabel(d) {
  const { kind, b, p } = d.data;
  if (kind === 'root') return `Goal: ${state.map.goal}. Edit goal and background.`;
  if (kind === 'branch') return `Branch: ${b.label}, ${b.people.length} people, ${b.collapsed ? 'collapsed' : 'expanded'}. Enter edits, arrow keys collapse or expand.`;
  if (kind === 'person') return `${p.name}, ${p.headline}. Open details.`;
  if (kind === 'status') return `${b.label}: ${statusText(b)}`;
  return 'Add a new branch';
}

function activate(d) {
  const { kind, b, p } = d.data;
  if (kind === 'root') openGoal();
  else if (kind === 'branch' || kind === 'status') openBranch(b.id);
  else if (kind === 'person') openPerson(b.id, p.id);
  else if (kind === 'add') openNewBranch();
}

// What a node shows; it is only redrawn when this changes, so the root rings keep breathing.
function signature(d) {
  const { kind, b, p } = d.data;
  if (kind === 'root') return `root|${state.map.goal}`;
  if (kind === 'branch') return `branch|${b.label}|${b.people.length}|${b.collapsed ? 1 : 0}|${b.status}`;
  if (kind === 'person') return `person|${p.name}|${p.headline}`;
  if (kind === 'status') return `status|${b.status}|${statusText(b)}`;
  return kind;
}

function drawNode(n, d) {
  n.on('click', (_e, datum) => activate(datum))
    .on('keydown', (e, datum) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate(datum);
      } else if (datum.data.kind === 'branch' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        setCollapsed(datum.data.id, e.key === 'ArrowLeft');
      }
    })
    .on('mouseenter focus', (_e, datum) => lightPath(datum))
    .on('mouseleave blur', () => lightPath(selectedNode()));
  if (d.data.kind === 'branch' || d.data.kind === 'person') n.call(drag);

  const sig = signature(d);
  if (n.property('__sig') === sig) return;
  n.property('__sig', sig);
  n.selectAll('*').remove();
  const { kind } = d.data;

  if (kind === 'root') {
    n.append('circle').attr('class', 'hit').attr('r', 48);
    n.append('circle').attr('class', 'ring outer').attr('r', 44);
    n.append('circle').attr('class', 'ring inner').attr('r', 26);
    n.append('circle').attr('class', 'core').attr('r', 7);
    const text = n.append('text').attr('text-anchor', 'end');
    const lines = wrap(state.map.goal, 20);
    lines.forEach((l, i) =>
      text
        .append('tspan')
        .attr('x', -64)
        .attr('dy', i === 0 ? `${0.35 - (lines.length - 1) * 0.55}em` : '1.1em')
        .text(l),
    );
  } else if (kind === 'branch') {
    const { b, w } = d.data;
    n.append('rect').attr('class', 'drop-ring').attr('x', -6).attr('y', -PILL_H / 2 - 6).attr('width', w + 12).attr('height', PILL_H + 12).attr('rx', PILL_H / 2 + 6);
    n.append('rect').attr('class', 'pill-bg').attr('y', -PILL_H / 2).attr('width', w).attr('height', PILL_H).attr('rx', PILL_H / 2);
    n.append('circle').attr('class', 'lamp').attr('cx', 16).attr('r', 3);
    n.append('text').attr('class', 'name').attr('x', 28).attr('y', 4).text(truncate(b.label, 26));
    // Collapse toggle: the count plus a caret, at the pill's right end.
    const t = n.append('g').attr('class', 'toggle').attr('transform', `translate(${w - 48},0)`);
    t.append('rect').attr('class', 'toggle-hit').attr('y', -PILL_H / 2).attr('width', 48).attr('height', PILL_H).attr('rx', PILL_H / 2);
    t.append('line').attr('class', 'toggle-rule').attr('x1', 0).attr('x2', 0).attr('y1', -8).attr('y2', 8);
    t.append('text').attr('class', 'count').attr('x', 10).attr('y', 4).text(String(b.people.length).padStart(2, '0'));
    t.append('path').attr('class', 'caret').attr('d', b.collapsed ? 'M33 -4 L37 0 L33 4' : 'M31 -2 L35 2 L39 -2');
    t.append('title').text(b.collapsed ? 'Expand branch' : 'Collapse branch');
    t.on('click', (e) => {
      e.stopPropagation();
      setCollapsed(b.id, !findBranch(b.id)?.collapsed);
    });
  } else if (kind === 'person') {
    const { p } = d.data;
    n.append('rect').attr('class', 'card').attr('y', -CARD_H / 2).attr('width', CARD_W).attr('height', CARD_H).attr('rx', 12);
    n.append('circle').attr('class', 'mark-ring').attr('cx', CARD_W - 18).attr('cy', -CARD_H / 2 + 14).attr('r', 7);
    n.append('circle').attr('class', 'mark-dot').attr('cx', CARD_W - 18).attr('cy', -CARD_H / 2 + 14).attr('r', 2.5);
    n.append('text').attr('class', 'title').attr('x', 16).attr('y', -3).text(truncate(p.name, 27));
    n.append('text').attr('class', 'org').attr('x', 16).attr('y', 15).text(truncate(p.headline, 30));
  } else if (kind === 'status') {
    const { b } = d.data;
    const dots = b.status === 'loading' ? [4, 12, 20] : [4];
    dots.forEach((cx) => n.append('circle').attr('class', 'dot').attr('cx', cx).attr('r', 2.2));
    n.append('text').attr('x', dots.at(-1) + 12).attr('y', 4).text(truncate(statusText(b), 42));
  } else if (kind === 'add') {
    n.append('rect').attr('y', -PILL_H / 2).attr('width', d.data.w).attr('height', PILL_H).attr('rx', PILL_H / 2);
    n.append('text').attr('x', d.data.w / 2).attr('y', 4).attr('text-anchor', 'middle').text('+ NEW BRANCH');
  }
}

function selectedNode() {
  const v = state.view;
  if (!v || !lastRoot) return null;
  return lastRoot.descendants().find((d) => {
    if (v.kind === 'person') return d.data.kind === 'person' && d.data.b.id === v.branchId && d.data.p.id === v.personId;
    if (v.kind === 'branch') return d.data.kind === 'branch' && d.data.id === v.branchId;
    return false;
  });
}

function markActive() {
  const v = state.view;
  // Focus: while a person or branch is open, everything outside that branch steps back.
  const focusId = v && (v.kind === 'person' || v.kind === 'branch') ? v.branchId : null;
  svg.classed('focusing', Boolean(focusId));
  const inFocus = (d) => d.data.kind === 'root' || d.data.id === focusId || d.data.b?.id === focusId;
  nodeLayer.selectAll('g.node').classed('in-focus', (d) => Boolean(focusId) && inFocus(d));
  linkLayer.selectAll('path').classed('in-focus', (l) => Boolean(focusId) && inFocus(l.target));
  nodeLayer.selectAll('g.node').classed('active', (d) => {
    if (!v) return false;
    if (v.kind === 'person') return d.data.kind === 'person' && d.data.b.id === v.branchId && d.data.p.id === v.personId;
    if (v.kind === 'branch') return d.data.kind === 'branch' && d.data.id === v.branchId;
    if (v.kind === 'goal') return d.data.kind === 'root';
    return false;
  });
  lightPath(selectedNode());
}

// Light the path from a node back to the goal, with a particle of signal running along it.
let litPaths = [];
let particleFrame = 0;

function lightPath(d) {
  const ids = new Set();
  for (let n = d; n?.parent; n = n.parent) ids.add(n.data.id);
  const lit = linkLayer.selectAll('path:not(.exiting)').classed('lit', (l) => ids.has(l.target.data.id));
  litPaths = lit.filter((l) => ids.has(l.target.data.id)).nodes().sort((a, b) => d3.select(a).datum().target.depth - d3.select(b).datum().target.depth);

  if (!litPaths.length || reduceMotion.matches) {
    cancelAnimationFrame(particleFrame);
    particleFrame = 0;
    particleLayer.selectAll('*').remove();
    return;
  }
  if (particleFrame) return; // already running; it reads litPaths every frame
  const dot = particleLayer.append('circle').attr('class', 'particle').attr('r', 2.6);
  const start = performance.now();
  const step = (now) => {
    particleFrame = requestAnimationFrame(step);
    const paths = litPaths.filter((p) => p.isConnected);
    const t = ((now - start) % 2200) / 1500; // travel for 1.5s, rest for 0.7s
    if (!paths.length || t > 1) return dot.attr('opacity', 0);
    const lens = paths.map((p) => p.getTotalLength());
    let at = d3.easeCubicInOut(t) * d3.sum(lens);
    let i = 0;
    while (i < paths.length - 1 && at > lens[i]) at -= lens[i++];
    const pt = paths[i].getPointAtLength(Math.min(at, lens[i]));
    dot.attr('opacity', 1).attr('cx', pt.x).attr('cy', pt.y);
  };
  particleFrame = requestAnimationFrame(step);
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
    if (
      n.data.kind === 'branch' &&
      px > n.y - 12 && px < n.y + n.data.w + 12 &&
      Math.abs(py - n.x) < PILL_H / 2 + 14
    ) return b.id;
    if (
      (n.data.kind === 'person' || n.data.kind === 'status') &&
      px > n.y - 10 && px < n.y + CARD_W + 10 &&
      Math.abs(py - n.x) < CARD_H / 2 + 6
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
    const half = k === 'root' ? 50 : CARD_H / 2;
    extent.left = Math.min(extent.left, n.y - (k === 'root' ? 330 : 8));
    extent.right = Math.max(extent.right, n.y + (k === 'person' || k === 'status' ? CARD_W : k === 'root' ? 50 : n.data.w + 8));
    extent.top = Math.min(extent.top, n.x - half);
    extent.bottom = Math.max(extent.bottom, n.x + half);
  }
  const box = { x: extent.left, y: extent.top, width: extent.right - extent.left, height: extent.bottom - extent.top };

  const rect = svg.node().getBoundingClientRect();
  const { height } = rect;
  // Fit into the space left of the detail panel, unless it covers the whole map (narrow screens).
  const panel = els.detail.classList.contains('open') ? els.detail.offsetWidth : 0;
  const width = rect.width - panel >= 300 ? rect.width - panel : rect.width;
  const pad = 48;
  const k = Math.max(0.3, Math.min(1.05, (width - pad * 2) / box.width, (height - pad * 2) / box.height));
  const tx = width / 2 - k * (box.x + box.width / 2);
  const ty = height / 2 - k * (box.y + box.height / 2);
  const t = d3.zoomIdentity.translate(tx, ty).scale(k);
  (animate ? svg.transition('fit').duration(600) : svg).call(zoom.transform, t);
}

// Refit when the map area changes size (window resize, chat collapsing), unless the user has taken over.
new ResizeObserver(() => state.map && autoFit && fitToView(false)).observe(document.querySelector('.map'));

function zoomBy(factor) {
  autoFit = false;
  svg.transition('fit').duration(250).call(zoom.scaleBy, factor);
}

// The part of the map not covered by the detail panel, in screen pixels relative to the svg.
function visibleArea() {
  const rect = svg.node().getBoundingClientRect();
  const area = { left: 0, top: 0, right: rect.width, bottom: rect.height };
  if (els.detail.classList.contains('open')) {
    // Use the panel's final size, not its rect: it may still be sliding in.
    const { offsetWidth: w, offsetHeight: h } = els.detail;
    if (w >= rect.width - 4) area.bottom = Math.min(area.bottom, window.innerHeight - h - rect.top); // bottom sheet
    else area.right = rect.width - w;
  }
  return area;
}

// Pan just enough to bring a node fully into the visible area (never zooms).
function ensureVisible(d) {
  if (!d) return;
  const t = d3.zoomTransform(svg.node());
  const k = d.data.kind;
  const w = k === 'person' || k === 'status' ? CARD_W : k === 'root' ? 50 : d.data.w;
  const left = t.applyX(d.y - (k === 'root' ? 300 : 0));
  const right = t.applyX(d.y + w);
  const top = t.applyY(d.x - CARD_H / 2);
  const bottom = t.applyY(d.x + CARD_H / 2);
  const a = visibleArea();
  const pad = 32;
  let dx = 0;
  let dy = 0;
  if (right > a.right - pad) dx = a.right - pad - right;
  if (left + dx < a.left + pad) dx = a.left + pad - left;
  if (bottom > a.bottom - pad) dy = a.bottom - pad - bottom;
  if (top + dy < a.top + pad) dy = a.top + pad - top;
  if (!dx && !dy) return;
  svg.transition('fit').duration(450).ease(d3.easeCubicOut).call(zoom.translateBy, dx / t.k, dy / t.k);
}

function setCollapsed(branchId, collapsed) {
  const b = findBranch(branchId);
  if (!b || Boolean(b.collapsed) === collapsed) return;
  b.collapsed = collapsed;
  if (collapsed && state.view?.kind === 'person' && state.view.branchId === branchId) openBranch(branchId);
  commit();
}

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
  els.input.placeholder = has ? 'Ask for a change…' : 'Describe your goal…';
  els.zoomIn.disabled = !has;
  els.zoomOut.disabled = !has;
  els.mapCount.hidden = !has;
  if (has) {
    const people = state.map.branches.reduce((n, b) => n + b.people.length, 0);
    els.mapCount.textContent = `Fig. map · ${state.map.branches.length} branches · ${people} people`;
  }
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

const fmtDates = (x) => [x.from, x.to ?? (x.from ? 'now' : null)].filter(Boolean).join(' - ');

let personTab = 'prep'; // remembered while stepping between people

function stepPerson(dir) {
  const v = state.view;
  const b = v && findBranch(v.branchId);
  if (!b || !b.people.length) return;
  const i = b.people.findIndex((p) => p.id === v.personId);
  const next = b.people[(i + dir + b.people.length) % b.people.length];
  openPerson(b.id, next.id);
}

function iconButton(icon, label, onClick, cls = '') {
  const b = el('button', `icon-btn ${cls}`.trim());
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML = `<i class="ph-light ph-${icon}" aria-hidden="true"></i>`;
  b.addEventListener('click', onClick);
  return b;
}

// Small overflow menu (details/summary keeps it keyboard and screen-reader friendly).
function menu(label, items) {
  const d = el('details', 'menu');
  const summary = el('summary', 'icon-btn');
  summary.setAttribute('aria-label', label);
  summary.title = label;
  summary.innerHTML = '<i class="ph-light ph-dots-three" aria-hidden="true"></i>';
  const list = el('div', 'menu-list');
  list.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.heading) {
      list.append(el('p', 'menu-heading', item.heading));
      continue;
    }
    const b = button(item.label, `menu-item${item.danger ? ' danger' : ''}`, () => {
      d.removeAttribute('open');
      item.onClick();
    });
    b.setAttribute('role', 'menuitem');
    list.append(b);
  }
  d.append(summary, list);
  return d;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied talking point');
  } catch {
    toast('Copy failed. Select the text instead.');
  }
}

function openPerson(branchId, personId) {
  const b = findBranch(branchId);
  const p = b?.people.find((x) => x.id === personId);
  if (!p) return dismissDetail();
  if (b.collapsed) {
    b.collapsed = false;
    commit();
  }
  const body = openView({ kind: 'person', branchId, personId });
  const index = b.people.indexOf(p);

  // Header: where you are, who this is, and the one action that matters.
  const nav = el('div', 'sheet-nav');
  nav.append(el('p', 'tag', b.label));
  if (b.people.length > 1) {
    const stepper = el('div', 'stepper');
    stepper.append(
      iconButton('caret-left', 'Previous person (←)', () => stepPerson(-1)),
      el('span', 'step-count', `${index + 1} / ${b.people.length}`),
      iconButton('caret-right', 'Next person (→)', () => stepPerson(1)),
    );
    nav.append(stepper);
  }

  const head = el('div', 'person-head');
  const avatar = el('div', 'avatar', initials(p.name));
  if (p.image) {
    const img = el('img');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = p.image;
    img.onload = () => { avatar.textContent = ''; avatar.append(img); };
  }
  const who = el('div', 'who');
  who.append(el('h2', null, p.name), el('p', 'org', [p.headline, p.location].filter(Boolean).join(' · ')));
  head.append(avatar, who);

  const actions = el('div', 'sheet-actions');
  const link = p.url && profileLink(p.url);
  if (link) {
    const a = el('a', 'pill pill-primary sm', link.label);
    a.href = p.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = link.short;
    actions.append(a);
  } else {
    actions.append(el('span', 'no-link', 'No profile link'));
  }
  const others = state.map.branches.filter((x) => x.id !== branchId);
  actions.append(
    menu('More actions', [
      ...(others.length ? [{ heading: 'Move to' }, ...others.map((o) => ({ label: o.label, onClick: () => movePerson(branchId, personId, o.id) }))] : []),
      { label: 'Remove from map', danger: true, onClick: () => { removePerson(branchId, personId); openBranch(branchId); } },
    ]),
  );

  body.append(nav, head, actions);
  if (p.why) body.append(el('p', 'why lead', p.why));

  // Tabs: prep (what you'll say) first, profile (the facts behind it) second.
  const tabs = el('div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Person details');
  const panels = {};
  const tabButtons = {};
  const select = (name, focus) => {
    personTab = name;
    for (const key of Object.keys(panels)) {
      const on = key === name;
      tabButtons[key].setAttribute('aria-selected', String(on));
      tabButtons[key].tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    }
    if (focus) tabButtons[name].focus();
  };
  const addTab = (name, label) => {
    const t = button(label, 'tab', () => select(name));
    t.id = `tab-${name}`;
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-controls', `panel-${name}`);
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation(); // arrows switch tabs here, not people
      select(name === 'prep' ? 'profile' : 'prep', true);
    });
    const panel = el('div', 'tab-panel');
    panel.id = `panel-${name}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', t.id);
    tabButtons[name] = t;
    panels[name] = panel;
    tabs.append(t);
  };
  addTab('prep', 'Prep');
  addTab('profile', 'Profile');
  body.append(tabs);

  // Prep: talking points, each copyable.
  if (p.talking_points?.length) {
    const ol = el('ol', 'points');
    p.talking_points.forEach((t) => {
      const li = el('li');
      li.append(el('span', 'point-text', t), iconButton('copy', 'Copy talking point', () => copyText(t), 'copy'));
      ol.append(li);
    });
    panels.prep.append(ol);
  } else {
    panels.prep.append(el('p', 'why', 'No talking points for this person yet.'));
  }
  panels.prep.append(el('p', 'soon-note label', 'Coffee-chat practice · Soon'));

  // Profile: the facts the talking points are built from.
  if (p.summary) panels.profile.append(el('p', 'why', p.summary));
  const rows = [];
  const row = (k, v, cls) => {
    const r = el('div', 'data-row');
    r.append(el('span', 'k', k), el('span', `v${cls ? ` ${cls}` : ''}`, v));
    return r;
  };
  const stack = (k, entries) => {
    const r = el('div', 'data-row stack');
    r.append(el('span', 'k', k));
    entries.forEach(([left, right]) => {
      const e = el('div', 'entry');
      e.append(el('span', null, left), el('span', null, right));
      r.append(e);
    });
    return r;
  };
  const ties = p.in_common ?? [];
  rows.push(ties.length ? stack(`Shared ties · ${ties.length}`, ties.map((t) => [t, ''])) : row('Shared ties', 'None found'));
  if (p.experience?.length) {
    rows.push(stack('Experience', p.experience.map((x) => [[x.title, x.company].filter(Boolean).join(', '), fmtDates(x)])));
  }
  if (p.education?.length) {
    rows.push(stack('Education', p.education.map((x) => [[x.degree, x.school].filter(Boolean).join(', '), fmtDates(x)])));
  }
  if (link) rows.push(row('Source', link.short));
  const panel = el('div', 'data-panel');
  panel.append(...rows);
  panels.profile.append(panel);

  body.append(panels.prep, panels.profile);
  select(personTab);
  showDetail();
}

function openBranch(id) {
  const b = findBranch(id);
  if (!b) return dismissDetail();
  const body = openView({ kind: 'branch', branchId: id });

  const nav = el('div', 'sheet-nav');
  nav.append(el('p', 'tag', 'Branch'));
  body.append(nav, el('h2', null, b.label));
  if (b.why) body.append(el('p', 'why lead', b.why));

  // People first: that's what this branch is for.
  body.append(el('div', 'branch-people'));
  refreshBranchPeople(id);

  // Editing stays folded until asked for.
  const edit = el('details', 'disclosure');
  edit.append(el('summary', null, 'Edit name & search'));
  const name = input(b.label, 'e.g. UW alumni at Microsoft…');
  const why = textarea(b.why, 'Why this group matters for your goal…', 2);
  const query = textarea(b.query, 'e.g. product managers at Microsoft who studied at UW…', 3);
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
  edit.append(form);
  body.append(edit);

  function saveEdits(research) {
    const fields = { label: name.value.trim() || b.label, why: why.value.trim(), query: query.value.trim() };
    const changed = fields.label !== b.label || fields.why !== b.why || fields.query !== b.query;
    if (changed) updateBranch(id, fields);
    else if (research) snapshot();
    if (research) loadPeople(id, 'replace');
    flash(saveBtn, research ? 'Searching…' : changed ? 'Saved' : 'No changes');
    if (changed) body.querySelector('h2').textContent = fields.label;
  }

  const more = el('div', 'sheet-footer');
  if (state.map.branches.length > 1) {
    more.append(button('Merge with another branch…', 'quiet', () => openMerge([id])));
  }
  more.append(button(b.collapsed ? 'Expand on map' : 'Collapse on map', 'quiet', () => {
    setCollapsed(id, !b.collapsed);
    openBranch(id);
  }));
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

// The people list inside the branch sheet updates on its own, so a finished search
// doesn't wipe out edits being typed into the form below it.
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
    const remove = iconButton('x', `Remove ${p.name}`, () => removePerson(id, p.id), 'remove');
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
  body.append(el('p', 'tag', 'Goal'));
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
  body.append(el('p', 'tag', 'New branch'), el('h2', null, 'Add a group of people'));

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
  body.append(el('p', 'tag', 'Merge branches'), el('h2', null, 'Combine branches'));
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
  // Keep the map clear of the panel: refit while auto-fitting, otherwise just bring the selection into view.
  if (!wasOpen && autoFit) fitToView(true);
  else requestAnimationFrame(() => ensureVisible(selectedNode()));
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

// ---------------------------------------------------------------------------
// Resizable panels: drag an edge, use the arrow keys on it, or the widen button.
// Widths are remembered in this browser and kept within limits that leave the map usable.
// ---------------------------------------------------------------------------

const SIZE_KEY = 'netprep:panel-sizes';
const phone = window.matchMedia('(max-width: 760px)');
const mapWidth = () => document.querySelector('.map').clientWidth;

const panels = {
  chat: {
    prop: '--chat-w',
    edge: 'right', // dragging right makes it wider
    def: 360,
    min: 280,
    max: () => Math.max(280, Math.min(760, window.innerWidth * 0.55)),
    wide: () => Math.max(280, Math.min(600, window.innerWidth * 0.42)),
    handle: $('chat-resize'),
    toggle: $('chat-expand'),
    box: $('chat'),
    noun: 'chat',
  },
  detail: {
    prop: '--detail-w',
    edge: 'left', // dragging left makes it wider
    def: 380,
    min: 320,
    max: () => Math.max(320, Math.min(900, mapWidth() - 240)),
    wide: () => Math.max(320, Math.min(680, mapWidth() - 300)),
    handle: $('detail-resize'),
    toggle: $('detail-expand'),
    box: els.detail,
    noun: 'panel',
  },
};

const sizes = { chat: panels.chat.def, detail: panels.detail.def };
const previous = {}; // width to return to when un-widening
try {
  Object.assign(sizes, JSON.parse(localStorage.getItem(SIZE_KEY)) ?? {});
} catch {}

function setSize(name, px, { persist = false } = {}) {
  const p = panels[name];
  const max = p.max();
  sizes[name] = Math.round(Math.min(max, Math.max(p.min, px)));
  document.documentElement.style.setProperty(p.prop, `${sizes[name]}px`);
  p.handle.setAttribute('aria-valuemin', String(p.min));
  p.handle.setAttribute('aria-valuemax', String(Math.round(max)));
  p.handle.setAttribute('aria-valuenow', String(sizes[name]));
  syncToggle(name);
  if (persist) {
    try { localStorage.setItem(SIZE_KEY, JSON.stringify(sizes)); } catch {}
  }
}

function isWide(name) {
  return phone.matches ? panels[name].box.classList.contains('tall') : sizes[name] >= panels[name].wide() - 8;
}

function syncToggle(name) {
  const p = panels[name];
  const wide = isWide(name);
  const verb = phone.matches ? (wide ? 'Shrink' : 'Enlarge') : wide ? 'Narrow' : 'Widen';
  p.toggle.setAttribute('aria-pressed', String(wide));
  p.toggle.setAttribute('aria-label', `${verb} ${p.noun}`);
  p.toggle.title = `${verb} ${p.noun}`;
  const icon = phone.matches
    ? (wide ? 'arrows-in-line-vertical' : 'arrows-out-line-vertical')
    : wide ? 'arrows-in-line-horizontal' : 'arrows-out-line-horizontal';
  p.toggle.innerHTML = `<i class="ph-light ph-${icon}" aria-hidden="true"></i>`;
}

// The map reacts: refit while auto-fitting, otherwise keep the selection in view.
let refitFrame = 0;
function afterResize(name, done) {
  if (!state.map) return;
  cancelAnimationFrame(refitFrame);
  refitFrame = requestAnimationFrame(() => {
    if (autoFit) fitToView(false);
    else if (done && name === 'detail') ensureVisible(selectedNode());
  });
}

function toggleWide(name) {
  const p = panels[name];
  if (phone.matches) {
    // On phones the panels stack, so "wider" means taller.
    p.box.classList.toggle('tall');
    syncToggle(name);
    return;
  }
  if (isWide(name)) {
    setSize(name, previous[name] && previous[name] < p.wide() - 8 ? previous[name] : p.def, { persist: true });
  } else {
    previous[name] = sizes[name];
    setSize(name, p.wide(), { persist: true });
  }
  afterResize(name, true);
}

for (const [name, p] of Object.entries(panels)) {
  setSize(name, sizes[name]);
  p.toggle.addEventListener('click', () => toggleWide(name));

  p.handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    p.handle.setPointerCapture(e.pointerId);
    p.handle.classList.add('dragging');
    document.body.classList.add('resizing');
    const startX = e.clientX;
    const startW = sizes[name];
    const sign = p.edge === 'right' ? 1 : -1;
    const move = (ev) => {
      setSize(name, startW + sign * (ev.clientX - startX));
      afterResize(name, false);
    };
    const end = () => {
      p.handle.classList.remove('dragging');
      document.body.classList.remove('resizing');
      p.handle.removeEventListener('pointermove', move);
      setSize(name, sizes[name], { persist: true });
      afterResize(name, true);
    };
    p.handle.addEventListener('pointermove', move);
    p.handle.addEventListener('pointerup', end, { once: true });
    p.handle.addEventListener('pointercancel', end, { once: true });
  });

  p.handle.addEventListener('dblclick', () => {
    setSize(name, p.def, { persist: true });
    afterResize(name, true);
  });

  p.handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 64 : 16;
    const grow = p.edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = p.edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
    let next = null;
    if (e.key === grow) next = sizes[name] + step;
    else if (e.key === shrink) next = sizes[name] - step;
    else if (e.key === 'Home') next = p.min;
    else if (e.key === 'End') next = p.max();
    else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      toggleWide(name);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation(); // arrows resize here; they don't step between people
    setSize(name, next, { persist: true });
    afterResize(name, true);
  });
}

// Keep saved widths valid when the window changes size or crosses the phone breakpoint.
window.addEventListener('resize', () => {
  setSize('chat', sizes.chat);
  setSize('detail', sizes.detail);
});
phone.addEventListener?.('change', () => {
  syncToggle('chat');
  syncToggle('detail');
});

restore();
