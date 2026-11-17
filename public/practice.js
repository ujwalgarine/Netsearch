// Practice page (/app/practice): start a coffee chat with the double of someone you're tracking,
// and the list of past practice chats with their grades. The chat itself runs in the practice room
// (/app/practice/new?connection=<id>, practice-room.html), a separate page with camera and microphone
// access. Uses request, el, icon, iconButton and toast from app.js, and confirmDialog, dayBucket and
// shortDate from shell.js.

const px = {
  form: $('practice-form'),
  who: $('practice-who'),
  hint: $('practice-hint'),
  list: $('practice-list'),
  empty: $('practice-empty'),
  sessions: [],
  picked: null,
  seq: 0,
};

const roomHref = (connectionId) => `/app/practice/new${connectionId ? `?connection=${encodeURIComponent(connectionId)}` : ''}`;

async function showPractice() {
  const seq = ++px.seq;
  px.list.replaceChildren(el('p', 'label', 'Loading…'));
  px.empty.hidden = true;
  let sessions;
  let connections;
  try {
    [{ sessions }, { connections }] = await Promise.all([request('GET', '/api/practice/sessions'), request('GET', '/api/connections')]);
  } catch (err) {
    if (seq === px.seq) px.list.replaceChildren(el('p', 'field-error', err.message));
    return;
  }
  if (seq !== px.seq) return;
  px.sessions = sessions;
  renderPracticePicker(connections);
  renderPracticeSessions();
}

// Everyone you're tracking (saved or further along), then a sample partner for trying it out.
function renderPracticePicker(connections) {
  px.who.replaceChildren();
  for (const c of connections) {
    px.who.append(new Option([c.name, c.organization].filter(Boolean).join(' · ') || 'Unnamed connection', c.id));
  }
  px.who.append(new Option('A sample partner (no connection)', ''));
  // Keep what was picked before a refresh; otherwise the first person you're tracking.
  if (px.picked != null && [...px.who.options].some((o) => o.value === px.picked)) px.who.value = px.picked;
  px.hint.hidden = connections.length > 0;
}
px.who.addEventListener('change', () => { px.picked = px.who.value; });

px.form.addEventListener('submit', (e) => {
  e.preventDefault();
  location.assign(roomHref(px.who.value));
});

function renderPracticeSessions() {
  px.list.replaceChildren();
  if (!px.sessions.length) {
    px.empty.hidden = false;
    return;
  }
  px.empty.hidden = true;
  const groups = new Map();
  for (const s of px.sessions) {
    const key = dayBucket(s.created_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const [label, items] of groups) {
    const section = el('section', 'chat-group');
    section.append(el('h2', 'label', label));
    const ul = el('ul', 'chat-rows');
    items.forEach((s) => ul.append(practiceRow(s)));
    section.append(ul);
    px.list.append(section);
  }
}

function practiceRow(s) {
  const done = s.status === 'completed';
  const li = el('li', 'chat-row practice-row');
  const open = el('a', 'chat-open');
  // A finished chat opens its report; one left before the end starts over with the same person.
  open.href = done ? `/app/practice/${encodeURIComponent(s.id)}` : roomHref(s.connection?.id);
  const title = el('span', 'chat-title');
  title.append(el('span', null, s.partner));
  title.append(el('span', 'practice-based', s.connection ? ` · double of ${s.connection.name}${s.connection.organization ? `, ${s.connection.organization}` : ''}` : ' · sample partner'));
  const meta = el('span', 'chat-meta');
  meta.append(
    done && s.grade ? el('span', 'count', `${s.grade} · ${s.score}/100`) : el('span', null, done ? 'Graded' : 'Not finished'),
    el('span', null, shortDate(s.created_at)),
  );
  open.append(title, meta);

  const actions = el('div', 'chat-actions');
  actions.append(iconButton('trash', `Delete the practice chat with ${s.partner}`, () => confirmPracticeDelete(s)));
  li.append(open, actions);
  return li;
}

async function confirmPracticeDelete(s) {
  const ok = await confirmDialog({
    title: `Delete this practice chat with ${s.partner}?`,
    body: 'Its transcript and report are deleted for good.',
    action: 'Delete',
  });
  if (!ok) return;
  try {
    await request('DELETE', `/api/practice/sessions/${s.id}`);
    px.sessions = px.sessions.filter((x) => x.id !== s.id);
    renderPracticeSessions();
    toast('Practice chat deleted');
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`);
  }
}
