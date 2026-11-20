// Practice (/app/practice): history, setup, a streamed role-play chat, and the feedback report.
// Routes: /app/practice · /app/practice/new?connection=<id> · /app/practice/:id
// Uses request, el, icon, toast from app.js, fmtDay from connections.js and navigate from shell.js.

const pr = {
  panels: { list: $('pr-list'), setup: $('pr-setup'), chat: $('pr-chat'), report: $('pr-report') },
  view: $('view-practice'),
  connections: [], // the user's connections, for the setup picker
  session: null, // the open session: { id, persona, max_turns, turns_used, demo, talking_points, … }
  streaming: false,
  seq: 0, // ignore responses for a page the user already left
};

const RUBRIC_LABELS = [
  ['opening', 'Opening'],
  ['curiosity', 'Curiosity & question quality'],
  ['listening', 'Listening & follow-ups'],
  ['specificity', 'Specificity about yourself'],
  ['ask', 'The ask'],
  ['close', 'The close'],
];
const MOOD_LABEL = { friendly: 'Friendly', busy: 'Busy', skeptical: 'Skeptical' };
const MAX_CHARS = 1000;

function showPanel(name) {
  for (const [k, p] of Object.entries(pr.panels)) p.hidden = k !== name;
  pr.view.classList.toggle('is-chat', name === 'chat');
}

async function showPractice(sub) {
  const seq = ++pr.seq;
  if (!sub) return showPracticeList(seq);
  if (sub === 'new') return showPracticeSetup(seq, new URLSearchParams(location.search).get('connection'));
  return openPracticeSession(seq, sub);
}

const two = (n) => String(n).padStart(2, '0');
const personaInitial = (p) => (p?.first_name || '?').slice(0, 1).toUpperCase();

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

async function showPracticeList(seq) {
  showPanel('list');
  const rows = $('pr-rows');
  rows.replaceChildren(el('p', 'label', 'Loading…'));
  $('pr-empty').hidden = true;
  let sessions;
  try {
    ({ sessions } = await request('GET', '/api/practice'));
  } catch (err) {
    if (seq === pr.seq) rows.replaceChildren(el('p', 'field-error', err.message));
    return;
  }
  if (seq !== pr.seq) return;
  rows.replaceChildren();
  if (!sessions.length) {
    $('pr-empty').hidden = false;
    return;
  }
  const head = el('div', 'pr-row pr-row-head');
  head.setAttribute('aria-hidden', 'true');
  ['Connection', 'Goal', 'Date', 'Score'].forEach((t) => head.append(el('span', 'label', t)));
  const list = el('ul', 'pr-row-list');
  for (const s of sessions) list.append(sessionRow(s));
  rows.append(head, list);
}

function sessionRow(s) {
  const li = el('li');
  const a = el('a', `pr-row${s.status === 'active' ? ' is-active' : ''}`);
  a.href = `/app/practice/${s.id}`;
  a.dataset.nav = 'practice';

  const who = el('span', 'pr-row-who');
  who.append(
    el('span', 'pr-row-name', s.connection.name || 'Removed connection'),
    el('span', 'pr-row-role', [s.connection.title, s.connection.organization].filter(Boolean).join(' · ') || '—'),
  );
  const goal = el('span', 'pr-row-goal');
  goal.append(el('span', null, s.goal), el('span', 'pr-row-mood label', `${MOOD_LABEL[s.mood] ?? s.mood} · ${s.max_turns} turns`));
  const date = el('span', 'pr-row-date mono', fmtDay(s.created_at));

  const score = el('span', 'pr-row-score');
  if (s.status === 'completed' && typeof s.score === 'number') {
    score.append(scoreChip(s.score));
  } else {
    score.append(el('span', `pr-status label${s.status === 'active' ? ' live' : ''}`, s.status === 'active' ? 'In progress' : 'Ended early'));
  }
  if (s.demo) score.append(el('span', 'badge label', 'Demo'));
  a.append(who, goal, date, score);
  li.append(a);
  return li;
}

function scoreChip(score) {
  const chip = el('span', 'score-chip');
  chip.setAttribute('aria-label', `Score ${score} out of 10`);
  const bar = el('span', 'score-bar');
  bar.style.setProperty('--v', score / 10);
  chip.append(el('strong', null, String(score)), el('span', 'score-of', '/10'), bar);
  return chip;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const form = $('pr-form');
const connSelect = $('pr-connection');
const customGoal = $('pr-custom');
const formError = $('pr-form-error');

async function showPracticeSetup(seq, preselect) {
  showPanel('setup');
  formError.hidden = true;
  $('pr-start').disabled = false;
  connSelect.replaceChildren(el('option', null, 'Loading your connections…'));
  connSelect.disabled = true;
  try {
    const { connections } = await request('GET', '/api/connections?status=all');
    if (seq !== pr.seq) return;
    // Saved (tracked) connections, plus the preselected one even if it's only suggested.
    pr.connections = connections.filter((c) => c.status !== 'suggested' || c.id === preselect);
  } catch (err) {
    if (seq === pr.seq) connSelect.replaceChildren(el('option', null, `Couldn't load connections: ${err.message}`));
    return;
  }
  connSelect.replaceChildren();
  if (!pr.connections.length) {
    connSelect.append(el('option', null, 'No saved connections yet'));
    renderSheet($('pr-sheet-body'), null);
    $('pr-start').disabled = true;
    formError.textContent = 'Save a connection from one of your maps first.';
    formError.hidden = false;
    return;
  }
  connSelect.disabled = false;
  const ph = el('option', null, 'Choose a connection…');
  ph.value = '';
  connSelect.append(ph);
  for (const c of pr.connections) {
    const o = el('option', null, [c.name, [c.title, c.organization].filter(Boolean).join(' at ')].filter(Boolean).join(' — '));
    o.value = c.id;
    connSelect.append(o);
  }
  connSelect.value = pr.connections.some((c) => c.id === preselect) ? preselect : '';
  renderSheet($('pr-sheet-body'), currentConnection());
}

const currentConnection = () => pr.connections.find((c) => c.id === connSelect.value) ?? null;

connSelect.addEventListener('change', () => {
  renderSheet($('pr-sheet-body'), currentConnection());
  const url = connSelect.value ? `/app/practice/new?connection=${encodeURIComponent(connSelect.value)}` : '/app/practice/new';
  history.replaceState(null, '', url);
});

form.addEventListener('change', (e) => {
  if (e.target.name === 'goal') {
    customGoal.hidden = e.target.value !== 'custom';
    if (!customGoal.hidden) customGoal.focus();
  }
});

// The cheat sheet: who they are and the talking points from the map.
function renderSheet(box, c, extra) {
  box.replaceChildren();
  if (!c) {
    box.append(el('p', 'pr-sheet-empty', 'Pick a connection to see their background and your talking points.'));
    return;
  }
  const head = el('div', 'pr-sheet-head');
  head.append(el('p', 'label pr-sheet-for', 'Preparing for'), el('h3', 'pr-sheet-name', c.name || 'Your connection'), el('p', 'pr-sheet-role mono', [c.title, c.organization].filter(Boolean).join(' · ')));
  box.append(head);
  if (extra) box.append(extra);
  if (c.why) box.append(el('p', 'pr-sheet-why', c.why));
  const points = c.talking_points_json ?? c.talking_points ?? [];
  box.append(el('p', 'label pr-sheet-sub', 'Talking points'));
  if (points.length) {
    const ol = el('ol', 'pr-points');
    points.forEach((p) => ol.append(el('li', null, p)));
    box.append(ol);
  } else {
    box.append(el('p', 'pr-sheet-empty', 'No talking points saved for this person yet.'));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const data = new FormData(form);
  let goal = data.get('goal');
  if (goal === 'custom') goal = customGoal.value.trim();
  const problem = !connSelect.value ? 'Choose who you want to practice with.' : !goal ? 'Write your goal for the chat.' : '';
  if (problem) {
    formError.textContent = problem;
    formError.hidden = false;
    return;
  }
  const start = $('pr-start');
  start.disabled = true;
  start.firstChild.textContent = 'Setting the table… ';
  try {
    const s = await request('POST', '/api/practice', { connection_id: connSelect.value, goal, mood: data.get('mood'), length: data.get('length') });
    navigate(`/app/practice/${s.id}`);
  } catch (err) {
    formError.textContent = err.message;
    formError.hidden = false;
  } finally {
    start.disabled = false;
    start.firstChild.textContent = 'Start the chat ';
  }
});

// ---------------------------------------------------------------------------
// A session: the chat while active, the report once ended
// ---------------------------------------------------------------------------

async function openPracticeSession(seq, id) {
  let s;
  try {
    s = await request('GET', `/api/practice/${encodeURIComponent(id)}`);
  } catch (err) {
    if (seq !== pr.seq) return;
    toast(err.status === 404 ? "That practice chat doesn't exist." : `Couldn't open it: ${err.message}`);
    history.replaceState(null, '', '/app/practice');
    return showPracticeList(seq);
  }
  if (seq !== pr.seq) return;
  pr.session = s;
  if (s.status === 'active') renderChat(s);
  else renderReport(s, s.report);
}

// ---- chat ----

const msgBox = $('pr-messages');
const prInput = $('pr-input');
const sendBtn = $('pr-send');
const hintBox = $('pr-hint');

function renderChat(s) {
  showPanel('chat');
  document.title = `Practice with ${s.persona.first_name} · ${APP_NAME}`;
  $('pr-avatar').textContent = personaInitial(s.persona);
  $('pr-persona').replaceChildren(el('strong', null, s.persona.first_name), document.createTextNode(` · ${s.persona.label}`));
  $('pr-demo').hidden = !s.demo;
  hintBox.hidden = true;
  msgBox.replaceChildren();
  msgBox.append(chatIntro(s));
  for (const m of s.messages) msgBox.append(bubble(m.role, m.content));
  paintTurns();
  renderSheet($('pr-side-body'), { ...s.connection, talking_points: s.talking_points }, goalLine(s));
  $('pr-side-details').open = window.matchMedia('(min-width: 1101px)').matches;
  prInput.value = '';
  updateComposer();
  scrollChat();
  prInput.focus({ preventScroll: true });
}

function chatIntro(s) {
  const box = el('div', 'pr-intro');
  box.append(
    el('p', 'label', `${MOOD_LABEL[s.mood] ?? s.mood} · ${s.max_turns} turns`),
    el('p', 'pr-intro-text', `You're having coffee with ${s.persona.first_name}, a stand-in for someone like ${s.connection.name || 'your connection'}. Your goal: ${s.goal}.`),
  );
  return box;
}

function goalLine(s) {
  const p = el('p', 'pr-sheet-goal');
  p.append(el('span', 'label', 'Your goal'), el('span', null, s.goal));
  return p;
}

function bubble(role, text) {
  const m = el('div', `msg ${role === 'user' ? 'user' : 'assistant'} pr-msg`);
  if (role !== 'user') m.dataset.who = pr.session?.persona?.first_name ?? '';
  m.textContent = text;
  return m;
}

function paintTurns() {
  const s = pr.session;
  $('pr-turn-num').textContent = `${two(s.turns_used)} / ${two(s.max_turns)}`;
  const pips = $('pr-pips');
  pips.replaceChildren(...Array.from({ length: s.max_turns }, (_, i) => el('i', i < s.turns_used ? 'on' : null)));
  const left = s.max_turns - s.turns_used;
  prInput.placeholder = !s.turns_used ? `Say hello to ${s.persona.first_name}…` : left === 1 ? 'Last turn: wrap up and thank them…' : 'Your reply…';
}

const scrollChat = () => { msgBox.scrollTop = msgBox.scrollHeight; };

function updateComposer() {
  const n = prInput.value.length;
  const count = $('pr-count');
  count.textContent = `${n} / ${MAX_CHARS}`;
  count.classList.toggle('near', n > MAX_CHARS * 0.9);
  sendBtn.disabled = pr.streaming || !prInput.value.trim() || n > MAX_CHARS;
  prInput.style.height = 'auto';
  prInput.style.height = `${Math.min(prInput.scrollHeight, 160)}px`;
}
prInput.addEventListener('input', updateComposer);
prInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!sendBtn.disabled) $('pr-composer').requestSubmit();
  }
});

$('pr-composer').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = prInput.value.trim();
  const s = pr.session;
  if (!content || pr.streaming || !s) return;
  pr.streaming = true;
  hintBox.hidden = true;
  prInput.value = '';
  updateComposer();
  $('pr-end').disabled = true;
  $('pr-hint-btn').disabled = true;

  const mine = bubble('user', content);
  const reply = bubble('assistant', '');
  reply.classList.add('streaming');
  reply.append(typingDots());
  msgBox.append(mine, reply);
  scrollChat();

  let text = '';
  let finished = null;
  try {
    await streamPractice(`/api/practice/${s.id}/message`, { content }, (event, data) => {
      if (event === 'delta') {
        if (!text) reply.replaceChildren();
        text += data.text;
        reply.textContent = text;
        scrollChat();
      } else if (event === 'done') {
        finished = data;
      } else if (event === 'error') {
        throw new Error(data.error);
      }
    });
    if (!finished) throw new Error('The reply was cut off. Try again.');
  } catch (err) {
    reply.remove();
    mine.remove();
    prInput.value = content;
    updateComposer();
    toast(err.message);
    if (err.status === 409) return endPractice();
    return;
  } finally {
    reply.classList.remove('streaming');
    pr.streaming = false;
    $('pr-end').disabled = false;
    $('pr-hint-btn').disabled = false;
    updateComposer();
  }
  if (pr.session !== s) return; // the user navigated away mid-reply
  s.turns_used = finished.turn;
  paintTurns();
  if (finished.limit_reached) {
    const note = el('p', 'pr-system label', "That's time. Writing your feedback…");
    msgBox.append(note);
    scrollChat();
    setTimeout(endPractice, 900);
  } else {
    prInput.focus({ preventScroll: true });
  }
});

function typingDots() {
  const t = el('span', 'pr-typing');
  t.setAttribute('aria-label', `${pr.session?.persona?.first_name ?? 'They'} is typing`);
  t.append(el('i'), el('i'), el('i'));
  return t;
}

// POST that answers with Server-Sent Events; calls onEvent(event, data) for each one.
async function streamPractice(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    throw new Error('Your session ended. Sign in again.');
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (event) onEvent(event, data ? JSON.parse(data) : null);
    }
  }
}

// ---- hint ----

$('pr-hint-btn').addEventListener('click', async () => {
  const s = pr.session;
  if (!s || pr.streaming) return;
  const btn = $('pr-hint-btn');
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const { hint } = await request('POST', `/api/practice/${s.id}/hint`, {});
    if (pr.session !== s) return;
    $('pr-hint-text').textContent = hint;
    hintBox.hidden = false;
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
});
$('pr-hint-close').addEventListener('click', () => { hintBox.hidden = true; prInput.focus(); });
$('pr-hint-use').addEventListener('click', () => {
  prInput.value = $('pr-hint-text').textContent;
  hintBox.hidden = true;
  updateComposer();
  prInput.focus();
});

// ---- end ----

$('pr-end').addEventListener('click', () => endPractice());

async function endPractice() {
  const s = pr.session;
  if (!s || s.ending) return;
  s.ending = true;
  $('pr-end').disabled = true;
  sendBtn.disabled = true;
  prInput.disabled = true;
  showPanel('report');
  pr.panels.report.replaceChildren(writingState(s));
  try {
    const res = await request('POST', `/api/practice/${s.id}/end`, {});
    if (pr.session !== s) return;
    if (res.status === 'abandoned') {
      toast('Chat ended before you said anything, so there is nothing to score.');
      navigate('/app/practice');
      return;
    }
    const full = await request('GET', `/api/practice/${s.id}`);
    if (pr.session !== s) return;
    pr.session = full;
    renderReport(full, full.report);
  } catch (err) {
    toast(`Couldn't finish: ${err.message}`);
    s.ending = false;
    renderChat(s);
  } finally {
    prInput.disabled = false;
  }
}

function writingState(s) {
  const box = el('div', 'pr-writing');
  box.append(el('div', 'empty-rings'), el('p', null, `Reviewing your chat with ${s.persona.first_name}…`), el('p', 'label', 'Scoring six skills · finding your best lines'));
  box.firstChild.append(el('span'), el('span'), el('i'));
  return box;
}

// ---------------------------------------------------------------------------
// Feedback report
// ---------------------------------------------------------------------------

function renderReport(s, report) {
  showPanel('report');
  const root = pr.panels.report;
  root.replaceChildren();
  document.title = `Feedback · ${s.persona?.first_name ?? 'Practice'} · ${APP_NAME}`;

  const back = el('a', 'pr-back', null);
  back.href = '/app/practice';
  back.dataset.nav = 'practice';
  back.append(icon('arrow-left'), document.createTextNode('All practice chats'));

  const head = el('header', 'page-head pr-report-head');
  const h = el('h2', 'page-title');
  h.append(document.createTextNode('How it went with '), el('span', 'accent', s.persona?.first_name ?? 'them'), document.createTextNode('.'));
  const meta = el('p', 'pr-report-meta mono');
  meta.textContent = [s.connection?.name && `For ${s.connection.name}`, fmtDay(s.ended_at || s.created_at), s.goal, `${MOOD_LABEL[s.mood] ?? s.mood} mood`].filter(Boolean).join(' · ');
  head.append(back, el('p', 'label', `Fig. 04 · Debrief${s.demo ? ' · Demo' : ''}`), h, meta);
  root.append(head);

  if (!report) {
    const empty = el('div', 'page-empty');
    empty.append(el('p', null, 'This chat ended before you said anything, so there is no feedback.'));
    root.append(empty);
  } else {
    root.append(reportHero(s, report), rubricCard(report), listsCard(report));
    if (report.rewrite) root.append(rewriteCard(report.rewrite));
    root.append(followUpCard(report.follow_up_message, s));
  }
  root.append(transcriptCard(s));
}

// Score gauge: 60 ticks around a ring, filled clockwise to the score (design.md stat gauge).
function gauge(score) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('class', 'pr-gauge');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Overall score ${score} out of 10`);
  const lit = Math.round((score / 10) * 60);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2;
    const line = document.createElementNS(NS, 'line');
    const r1 = 80;
    const r2 = i < lit ? 94 : 90;
    line.setAttribute('x1', (Math.cos(a) * r1).toFixed(2));
    line.setAttribute('y1', (Math.sin(a) * r1).toFixed(2));
    line.setAttribute('x2', (Math.cos(a) * r2).toFixed(2));
    line.setAttribute('y2', (Math.sin(a) * r2).toFixed(2));
    line.setAttribute('class', i < lit ? 'on' : 'off');
    line.style.setProperty('--i', i);
    svg.append(line);
  }
  const t = document.createElementNS(NS, 'text');
  t.setAttribute('class', 'pr-gauge-num');
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('dominant-baseline', 'central');
  t.setAttribute('y', '-4');
  t.textContent = String(score);
  const of = document.createElementNS(NS, 'text');
  of.setAttribute('class', 'pr-gauge-of');
  of.setAttribute('text-anchor', 'middle');
  of.setAttribute('y', '38');
  of.textContent = 'OUT OF 10';
  svg.append(t, of);
  return svg;
}

function reportHero(s, r) {
  const card = el('section', 'pr-card pr-hero');
  const text = el('div', 'pr-hero-text');
  text.append(el('p', 'label', 'Overall'), el('p', 'pr-summary', r.summary));
  const actions = el('div', 'pr-hero-actions');
  const again = el('a', 'pill pill-primary sm');
  again.href = s.connection_id ? `/app/practice/new?connection=${encodeURIComponent(s.connection_id)}` : '/app/practice/new';
  again.dataset.nav = 'practice';
  again.append(icon('arrow-counter-clockwise'), document.createTextNode('Practice again'));
  actions.append(again);
  text.append(actions);
  card.append(gauge(r.overall_score), text);
  return card;
}

function rubricCard(r) {
  const card = el('section', 'pr-card pr-rubric');
  card.setAttribute('aria-labelledby', 'pr-rubric-title');
  const h = el('h3', 'pr-card-title', 'Rubric');
  h.id = 'pr-rubric-title';
  card.append(h);
  const ol = el('ol', 'pr-rubric-list');
  for (const [key, label] of RUBRIC_LABELS) {
    const item = r.rubric[key];
    const li = el('li', 'pr-rubric-row');
    const top = el('div', 'pr-rubric-top');
    const pips = el('span', 'pr-score-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 5; i++) pips.append(el('i', i <= item.score ? 'on' : null));
    top.append(el('span', 'pr-rubric-label', label), pips, el('span', 'pr-rubric-num mono', `${item.score}/5`));
    li.append(top, el('p', 'pr-rubric-note', item.note));
    if (item.evidence) {
      const q = el('blockquote', 'pr-quote');
      q.append(el('span', 'label', 'You said'), el('q', null, item.evidence));
      li.append(q);
    }
    ol.append(li);
  }
  card.append(ol);
  return card;
}

function listsCard(r) {
  const wrap = el('section', 'pr-two');
  const make = (title, items, cls, ic) => {
    const card = el('div', `pr-card pr-list-card ${cls}`);
    card.append(el('h3', 'pr-card-title', title));
    const ul = el('ul', 'pr-bullets');
    items.forEach((t) => {
      const li = el('li');
      li.append(icon(ic), el('span', null, t));
      ul.append(li);
    });
    card.append(ul);
    return card;
  };
  wrap.append(make('Strengths', r.strengths, 'good', 'check'), make('Try next time', r.improvements, 'next', 'arrow-up-right'));
  return wrap;
}

function rewriteCard(rw) {
  const card = el('section', 'pr-card pr-rewrite');
  card.append(el('h3', 'pr-card-title', 'One line, rewritten'));
  const grid = el('div', 'pr-rewrite-grid');
  const before = el('div', 'pr-rw before');
  before.append(el('p', 'label', 'You said'), el('p', 'pr-rw-text', rw.original));
  const after = el('div', 'pr-rw after');
  after.append(el('p', 'label', 'Stronger'), el('p', 'pr-rw-text', rw.stronger));
  grid.append(before, after);
  card.append(grid, el('p', 'pr-rw-why', rw.why));
  return card;
}

function followUpCard(text, s) {
  const card = el('section', 'pr-card pr-followup');
  const head = el('div', 'pr-followup-head');
  head.append(el('h3', 'pr-card-title', 'Follow-up message draft'));
  const copy = el('button', 'mono-btn', null);
  copy.type = 'button';
  copy.append(icon('copy'), document.createTextNode('Copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast("Couldn't copy. Select the text instead.");
    }
  });
  head.append(copy);
  card.append(head, el('p', 'pr-followup-text', text));
  card.append(el('p', 'pr-note', `Written for practice with ${s.persona?.first_name ?? 'the persona'}. Edit the name and details before sending it to ${s.connection?.name || 'the real person'}.`));
  return card;
}

function transcriptCard(s) {
  const d = el('details', 'pr-card pr-transcript');
  const sum = el('summary');
  const users = s.messages.filter((m) => m.role === 'user').length;
  sum.append(el('span', 'pr-card-title', 'Transcript'), el('span', 'label', `${users} ${users === 1 ? 'turn' : 'turns'}`));
  d.append(sum);
  const box = el('div', 'pr-transcript-body');
  for (const m of s.messages) {
    const row = el('div', `pr-t-row ${m.role === 'user' ? 'you' : 'them'}`);
    row.append(el('span', 'label', m.role === 'user' ? 'You' : s.persona?.first_name ?? 'Them'), el('p', null, m.content));
    box.append(row);
  }
  d.append(box);
  return d;
}
