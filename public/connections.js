// Connections: the outreach tracker. The Connections page (/app/connections[/:id]) and the
// shared tracker (status pipeline, follow-up date, autosaved notes) used by its detail panel
// and by the person panel on the map. Uses request, el, icon, button, iconButton, toast,
// flushSave, conversationId and connMeta from app.js.

const PIPELINE_STAGES = [
  { key: 'saved', label: 'Saved' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'replied', label: 'Replied' },
  { key: 'meeting_set', label: 'Meeting set', short: 'Meeting' },
  { key: 'met', label: 'Met' },
];
const STAGE_LABEL = Object.fromEntries([['suggested', 'Suggested'], ...PIPELINE_STAGES.map((s) => [s.key, s.label])]);
const NOTES_DELAY = 800;

const linkedInSearch = (c) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent([c.name, c.organization].filter(Boolean).join(' '))}`;
const practiceHref = (id) => `/app/practice/new?connection=${encodeURIComponent(id)}`;

function fmtDay(iso, opts = {}) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', ...opts });
}
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Five pips filled up to the stage, plus its name (never color alone).
function stagePips(status) {
  const wrap = el('span', 'stage');
  const pips = el('span', 'pips');
  pips.setAttribute('aria-hidden', 'true');
  const at = PIPELINE_STAGES.findIndex((s) => s.key === status);
  PIPELINE_STAGES.forEach((_, i) => pips.append(el('i', i <= at ? 'on' : null)));
  wrap.append(pips, el('span', 'stage-name', STAGE_LABEL[status] ?? status));
  return wrap;
}

// The tracker: status pipeline (segmented), follow-up date, notes (autosaved), practice link.
// `conn` is { id?, status, notes, follow_up_on }; `save(fields)` resolves to the updated row or null.
function trackerEditor(conn, save, { compact = false } = {}) {
  const state = { status: conn.status ?? 'suggested', notes: conn.notes ?? '', follow_up_on: conn.follow_up_on ?? '', id: conn.id ?? null };
  const box = el('div', `tracker${compact ? ' compact' : ''}`);

  const head = el('div', 'tracker-head');
  head.append(el('p', 'tag', 'Outreach'));
  const savedState = el('span', 'save-state label');
  savedState.setAttribute('aria-live', 'polite');
  head.append(savedState);
  box.append(head);

  // Segmented pipeline (radio group; arrow keys move).
  const seg = el('div', 'segmented');
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', 'Outreach status');
  const radios = PIPELINE_STAGES.map((s, i) => {
    const b = el('button', 'seg', s.short ?? s.label);
    b.type = 'button';
    if (s.short) b.setAttribute('aria-label', s.label);
    b.setAttribute('role', 'radio');
    b.dataset.status = s.key;
    b.addEventListener('click', () => setStatus(s.key));
    b.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      const next = radios[(i + dir + radios.length) % radios.length];
      next.focus();
      setStatus(next.dataset.status);
    });
    return b;
  });
  seg.append(...radios);
  box.append(seg);
  const hint = el('p', 'tracker-hint', 'Pick a stage to start tracking this person.');
  box.append(hint);

  // Follow-up date + notes.
  const date = el('input');
  date.type = 'date';
  date.value = state.follow_up_on || '';
  date.addEventListener('change', () => commit({ follow_up_on: date.value || null }));
  const clear = iconButton('x', 'Clear follow-up date', () => {
    date.value = '';
    commit({ follow_up_on: null });
  }, 'date-clear');
  const dateRow = el('div', 'date-row');
  dateRow.append(date, clear);
  const dateField = el('label', 'field');
  dateField.append(el('span', 'field-label', 'Follow up on'), dateRow);

  const notes = el('textarea');
  notes.rows = compact ? 3 : 5;
  notes.placeholder = 'What you sent, what they said, what to ask next…';
  notes.value = state.notes;
  let notesTimer = 0;
  notes.addEventListener('input', () => {
    savedState.textContent = 'Editing…';
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => commit({ notes: notes.value }), NOTES_DELAY);
  });
  notes.addEventListener('blur', () => {
    if (!notesTimer) return;
    clearTimeout(notesTimer);
    notesTimer = 0;
    if (notes.value !== state.notes) commit({ notes: notes.value });
  });
  const notesField = el('label', 'field');
  notesField.append(el('span', 'field-label', 'Notes'), notes);

  const editor = el('div', 'editor tracker-fields');
  editor.append(dateField, notesField);
  box.append(editor);

  const foot = el('div', 'tracker-foot');
  const practice = el('a', 'pill pill-ghost sm');
  practice.dataset.nav = 'practice';
  practice.append(icon('microphone'), document.createTextNode('Practice coffee chat'));
  const stop = button('Stop tracking', 'quiet', () => setStatus('suggested'));
  foot.append(practice, stop);
  box.append(foot);

  function paint() {
    const tracked = state.status !== 'suggested';
    radios.forEach((r) => {
      const on = r.dataset.status === state.status;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on || (!tracked && r === radios[0]) ? 0 : -1;
    });
    const at = PIPELINE_STAGES.findIndex((s) => s.key === state.status);
    radios.forEach((r, i) => r.classList.toggle('passed', i < at));
    hint.hidden = tracked;
    editor.hidden = !tracked;
    stop.hidden = !tracked;
    practice.hidden = !state.id || !tracked;
    if (state.id) practice.href = practiceHref(state.id);
  }

  async function setStatus(status) {
    if (status === state.status) return;
    const prev = state.status;
    state.status = status;
    paint();
    const row = await commit({ status });
    if (!row) {
      state.status = prev;
      paint();
    } else if (status === 'suggested') {
      toast('No longer tracking this person');
    } else if (prev === 'suggested') {
      toast('Saved to your connections');
    }
  }

  let pending = Promise.resolve();
  function commit(fields) {
    savedState.textContent = 'Saving…';
    pending = pending.then(async () => {
      const row = await save(fields);
      if (!row) {
        savedState.textContent = 'Not saved';
        return null;
      }
      Object.assign(state, { id: row.id, status: row.status, notes: row.notes ?? '', follow_up_on: row.follow_up_on ?? '' });
      savedState.textContent = 'Saved';
      paint();
      return row;
    });
    return pending;
  }

  paint();
  return box;
}

// Keep the open map's person panel in step with edits made anywhere.
function rememberConnection(row) {
  if (row && row.conversation_id === conversationId) {
    connMeta[row.person_key] = { id: row.id, status: row.status, notes: row.notes, follow_up_on: row.follow_up_on };
  }
}

// The tracker inside the map's person panel (people are matched by their id on the map).
function personTracker(person) {
  const meta = connMeta[person.id] ?? { status: 'suggested' };
  const cid = conversationId;
  return trackerEditor(meta, async (fields) => {
    await flushSave(); // the connection row is created when the map holding this person is saved
    try {
      const row = await request('PATCH', `/api/conversations/${cid}/connections`, { personKey: person.id, ...fields });
      rememberConnection(row);
      return row;
    } catch (err) {
      toast(err.status === 404 ? 'This person is still being saved. Try again in a moment.' : `Couldn't save: ${err.message}`);
      return null;
    }
  }, { compact: true });
}

// ---------------------------------------------------------------------------
// The Connections page
// ---------------------------------------------------------------------------

const cx = {
  rows: [],
  seq: 0,
  open: null,
  facetsLoaded: false,
  search: $('conn-search'),
  status: $('conn-status'),
  branch: $('conn-branch'),
  convo: $('conn-convo'),
  body: $('conn-rows'),
  table: $('conn-table-wrap'),
  empty: $('conn-empty'),
  emptyText: $('conn-empty-text'),
  count: $('conn-count'),
  detail: $('conn-detail'),
  detailBody: $('conn-detail-body'),
};

async function showConnectionsPage(openId) {
  await loadConnections({ facets: !cx.facetsLoaded });
  if (openId) openConnection(openId);
  else closeConnection({ keepUrl: true });
}

function connectionQuery() {
  const p = new URLSearchParams();
  if (cx.status.value !== 'tracked') p.set('status', cx.status.value);
  if (cx.branch.value) p.set('branch', cx.branch.value);
  if (cx.convo.value) p.set('conversation', cx.convo.value);
  if (cx.search.value.trim()) p.set('q', cx.search.value.trim());
  return p;
}

async function loadConnections({ facets = false } = {}) {
  const seq = ++cx.seq;
  const p = connectionQuery();
  if (facets) p.set('facets', '1');
  cx.table.classList.add('refreshing');
  try {
    const data = await request('GET', `/api/connections?${p}`);
    if (seq !== cx.seq) return;
    cx.rows = data.connections;
    if (data.facets) fillFacets(data.facets);
    renderConnections();
  } catch (err) {
    if (seq === cx.seq) toast(`Couldn't load connections: ${err.message}`);
  } finally {
    if (seq === cx.seq) cx.table.classList.remove('refreshing');
  }
}

function fillFacets(f) {
  cx.facetsLoaded = true;
  const keep = (select, options, allLabel) => {
    const current = select.value;
    select.replaceChildren(new Option(allLabel, ''), ...options.map(([v, t]) => new Option(t, v)));
    select.value = options.some(([v]) => v === current) ? current : '';
  };
  keep(cx.branch, f.branches.map((b) => [b, b]), 'All branches');
  keep(cx.convo, f.conversations.map((c) => [c.id, c.title]), 'All maps');
  cx.suggestedCount = f.suggested;
}

let searchTimer = 0;
cx.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadConnections(), 250);
});
for (const s of [cx.status, cx.branch, cx.convo]) s.addEventListener('change', () => loadConnections());

function filtersActive() {
  return cx.status.value !== 'tracked' || cx.branch.value || cx.convo.value || cx.search.value.trim();
}

function renderConnections() {
  const rows = cx.rows;
  cx.count.textContent = `${rows.length} ${rows.length === 1 ? 'connection' : 'connections'}`;
  cx.count.hidden = !rows.length;
  cx.table.hidden = !rows.length;
  cx.empty.hidden = Boolean(rows.length);
  if (!rows.length) {
    const filtered = filtersActive();
    cx.emptyText.textContent = filtered
      ? 'No connections match these filters.'
      : 'Save a connection from your map to start tracking outreach.';
    cx.empty.querySelector('.pill').hidden = Boolean(filtered);
    return;
  }

  cx.body.replaceChildren(
    ...rows.map((c) => {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.dataset.id = c.id;
      tr.setAttribute('aria-label', `${c.name}, ${STAGE_LABEL[c.status]}. Open details.`);
      if (cx.open === c.id) tr.classList.add('active');
      const who = el('td', 'who');
      who.append(el('span', 'conn-name', c.name || 'Unnamed'), el('span', 'conn-title', c.title));
      const status = el('td');
      status.append(stagePips(c.status));
      const due = el('td', 'mono');
      if (c.follow_up_on) {
        due.textContent = fmtDay(c.follow_up_on);
        if (c.follow_up_on <= localToday() && c.status !== 'suggested') due.classList.add('due');
      } else {
        due.textContent = '—';
      }
      tr.append(
        who,
        el('td', 'org', c.organization || '—'),
        el('td', 'branch', c.branch_label || '—'),
        status,
        due,
        el('td', 'mono muted', fmtDay(c.status_updated_at || c.created_at)),
      );
      tr.addEventListener('click', () => openConnection(c.id));
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openConnection(c.id);
        }
      });
      return tr;
    }),
  );
}

async function openConnection(id) {
  let c = cx.rows.find((r) => r.id === id);
  if (!c) {
    // Opened from a link (follow-ups, tips) while filtered: look it up among all of them.
    try {
      const all = await request('GET', '/api/connections?status=all');
      c = all.connections.find((r) => r.id === id);
    } catch {}
  }
  if (!c) {
    toast("That connection doesn't exist anymore.");
    history.replaceState(null, '', '/app/connections');
    return;
  }
  cx.open = id;
  if (location.pathname !== `/app/connections/${id}`) history.replaceState(null, '', `/app/connections/${id}`);
  cx.body.querySelectorAll('tr').forEach((tr) => tr.classList.toggle('active', tr.dataset.id === id));
  renderConnectionDetail(c);
  cx.detail.classList.add('open');
  cx.detail.setAttribute('aria-hidden', 'false');
  cx.detail.inert = false;
  cx.detail.scrollTop = 0;
}

function closeConnection({ keepUrl = false } = {}) {
  cx.open = null;
  cx.detail.classList.remove('open');
  cx.detail.setAttribute('aria-hidden', 'true');
  cx.detail.inert = true;
  cx.body.querySelectorAll('tr.active').forEach((tr) => tr.classList.remove('active'));
  if (!keepUrl && location.pathname !== '/app/connections') history.replaceState(null, '', '/app/connections');
}
$('conn-detail-close').addEventListener('click', () => closeConnection());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && cx.open && !$('view-connections').hidden && !e.target.closest?.('textarea, input')) closeConnection();
});

function renderConnectionDetail(c) {
  const body = cx.detailBody;
  body.replaceChildren();

  const nav = el('div', 'sheet-nav');
  nav.append(el('p', 'tag', c.branch_label || 'Connection'));
  body.append(nav, el('h2', null, c.name || 'Unnamed'));
  body.append(el('p', 'org conn-org', [c.title, c.organization].filter(Boolean).join(' · ')));
  if (c.conversation_id) {
    const from = el('a', 'from-map', `From: ${c.conversation_title || 'your map'}`);
    from.href = `/app/c/${c.conversation_id}`;
    from.dataset.nav = 'map';
    body.append(from);
  }

  const links = el('div', 'sheet-actions');
  if (c.profile_url) {
    const a = el('a', 'pill pill-primary sm', 'View profile ↗');
    a.href = c.profile_url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.append(a);
  }
  const li = el('a', `pill ${c.profile_url ? 'pill-ghost' : 'pill-primary'} sm`, 'Search LinkedIn ↗');
  li.href = linkedInSearch(c);
  li.target = '_blank';
  li.rel = 'noopener noreferrer';
  links.append(li);
  body.append(links);

  body.append(
    trackerEditor(c, async (fields) => {
      try {
        const row = await request('PATCH', `/api/connections/${c.id}`, fields);
        Object.assign(c, row);
        rememberConnection(row);
        renderConnections();
        return row;
      } catch (err) {
        toast(`Couldn't save: ${err.message}`);
        return null;
      }
    }),
  );

  if (c.why) body.append(el('p', 'why', c.why));
  const points = Array.isArray(c.talking_points_json) ? c.talking_points_json : [];
  if (points.length) {
    body.append(el('h3', null, 'Talking points'));
    const ol = el('ol', 'points');
    points.forEach((t) => {
      const item = el('li');
      item.append(el('span', 'point-text', t), iconButton('copy', 'Copy talking point', () => copyText(t), 'copy'));
      ol.append(item);
    });
    body.append(ol);
  }
}
