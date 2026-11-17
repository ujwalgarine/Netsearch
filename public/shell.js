// App shell: routes, sidebar, Past chats and Account. The map itself lives in app.js
// (startNewMap, openConversation, request, toast, el, icon and button come from there).
//
// Routes: /app (new map) · /app/c/:id (a saved chat) · /app/chats · /app/connections
//         /app/practice · /app/insights · /app/account
// /app/practice/<new|session id> is the practice room, a page of its own (practice-room.html).

const shell = {
  views: [...document.querySelectorAll('.views > [data-view]')],
  navLinks: [...document.querySelectorAll('[data-nav]')],
  user: null,
};

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function parseRoute(pathname) {
  const path = pathname.replace(/\/+$/, '') || '/app';
  const chat = path.match(/^\/app\/c\/([^/]+)$/);
  if (chat) return { view: 'map', id: decodeURIComponent(chat[1]) };
  const section = path.match(/^\/app\/(chats|connections|practice|insights|account)(?:\/([^/]+))?$/);
  if (section) return { view: section[1], sub: section[2] ? decodeURIComponent(section[2]) : null };
  return { view: 'map', id: null };
}

function showView(name) {
  for (const v of shell.views) v.hidden = v.dataset.view !== name;
  for (const a of shell.navLinks) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function route({ fresh = false } = {}) {
  const r = parseRoute(location.pathname);
  // The practice room has camera and microphone access and its own security policy, so it is loaded
  // as a page of its own (the server serves it at this address) rather than shown inside the app.
  if (r.view === 'practice' && r.sub) return location.replace(location.pathname + location.search);
  showView(r.view);
  if (r.view === 'map') {
    document.title = `${APP_NAME}`;
    if (r.id) {
      const found = await openConversation(r.id);
      if (!found) {
        history.replaceState(null, '', '/app');
        await startNewMap();
        toast("That chat doesn't exist anymore.");
      }
    } else if (fresh || conversationId || state.map || state.messages.length) {
      await startNewMap();
    }
    els.input.focus({ preventScroll: true });
    return;
  }
  document.title = `${r.view[0].toUpperCase()}${r.view.slice(1)} · ${APP_NAME}`;
  if (r.view === 'chats') loadChats();
  if (r.view === 'connections') showConnectionsPage(r.sub);
  if (r.view === 'practice') showPractice();
  if (r.view === 'insights') showInsights();
  if (r.view === 'account') renderAccount();
}

function navigate(path, opts) {
  if (path !== location.pathname + location.search) history.pushState(null, '', path);
  route(opts);
}

// Sidebar and in-app links. "New map" always starts fresh, even when already on /app.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href'), { fresh: a.dataset.nav === 'map' });
});
window.addEventListener('popstate', () => route());

// ---------------------------------------------------------------------------
// The signed-in user
// ---------------------------------------------------------------------------

const initialsOf = (name = '', email = '') =>
  (name.trim() ? name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') : email.slice(0, 1)).toUpperCase();

async function loadUser() {
  try {
    const { user } = await request('GET', '/api/auth/me');
    shell.user = user;
    $('side-name').textContent = user.name || user.email;
    $('side-initials').textContent = initialsOf(user.name, user.email);
    $('side-name').closest('.side-user').title = user.email;
  } catch {}
}

async function signOut() {
  await flushSave();
  try {
    await request('POST', '/api/auth/logout', {});
  } catch {}
  location.assign('/');
}
$('side-signout').addEventListener('click', signOut);
$('account-signout').addEventListener('click', signOut);

// ---------------------------------------------------------------------------
// Past chats
// ---------------------------------------------------------------------------

let chats = [];
const chatsList = $('chats-list');
const chatsEmpty = $('chats-empty');
const chatsSearch = $('chats-search');

async function loadChats() {
  chatsList.replaceChildren(el('p', 'label', 'Loading…'));
  chatsEmpty.hidden = true;
  try {
    ({ conversations: chats } = await request('GET', '/api/conversations'));
  } catch (err) {
    chatsList.replaceChildren(el('p', 'field-error', err.message));
    return;
  }
  renderChats();
}

chatsSearch.addEventListener('input', () => renderChats());

function dayBucket(iso) {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  return 'Older';
}

function shortDate(iso) {
  const d = new Date(iso);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function renderChats() {
  const q = chatsSearch.value.trim().toLowerCase();
  const shown = chats.filter((c) => !q || c.title.toLowerCase().includes(q));
  chatsList.replaceChildren();
  if (!shown.length) {
    $('chats-empty-text').textContent = chats.length ? `No chats match "${chatsSearch.value.trim()}".` : 'No chats yet. Your maps will be saved here.';
    chatsEmpty.querySelector('.pill').hidden = Boolean(chats.length);
    chatsEmpty.hidden = false;
    return;
  }
  chatsEmpty.hidden = true;

  const groups = new Map();
  for (const c of shown) {
    const key = dayBucket(c.updated_at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  for (const [label, items] of groups) {
    const section = el('section', 'chat-group');
    section.append(el('h2', 'label', label));
    const ul = el('ul', 'chat-rows');
    items.forEach((c) => ul.append(chatRow(c)));
    section.append(ul);
    chatsList.append(section);
  }
}

function chatRow(c) {
  const li = el('li', 'chat-row');
  const open = el('button', 'chat-open');
  open.type = 'button';
  const meta = el('span', 'chat-meta');
  meta.append(
    el('span', 'count', `${String(c.connection_count).padStart(2, '0')} ${c.connection_count === 1 ? 'connection' : 'connections'}`),
    el('span', null, shortDate(c.updated_at)),
  );
  open.append(el('span', 'chat-title', c.title), meta);
  open.addEventListener('click', () => navigate(`/app/c/${c.id}`));

  const actions = el('div', 'chat-actions');
  actions.append(
    iconButton('pencil-simple', `Rename "${c.title}"`, () => startRename(li, c)),
    iconButton('trash', `Delete "${c.title}"`, () => confirmDelete(c)),
  );
  li.append(open, actions);
  return li;
}

function startRename(li, c) {
  const form = el('form', 'chat-rename');
  const input = el('input');
  input.type = 'text';
  input.value = c.title;
  input.maxLength = 120;
  input.setAttribute('aria-label', 'Chat name');
  const saveBtn = el('button', 'btn primary', 'Save');
  saveBtn.type = 'submit';
  const cancel = button('Cancel', 'secondary', () => li.replaceWith(chatRow(c)));
  form.append(input, saveBtn, cancel);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = input.value.trim();
    if (!title || title === c.title) return li.replaceWith(chatRow(c));
    saveBtn.disabled = true;
    try {
      const updated = await request('PATCH', `/api/conversations/${c.id}`, { title });
      c.title = updated.title;
      li.replaceWith(chatRow(c));
      toast('Renamed');
    } catch (err) {
      saveBtn.disabled = false;
      toast(`Couldn't rename: ${err.message}`);
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      li.replaceWith(chatRow(c));
    }
  });
  li.replaceChildren(form);
  input.focus();
  input.select();
}

// Promise<boolean> from the shared confirm dialog.
function confirmDialog({ title, body, action }) {
  const dialog = $('confirm-dialog');
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('confirm-ok').textContent = action;
  dialog.returnValue = '';
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
}

async function confirmDelete(c) {
  const ok = await confirmDialog({
    title: `Delete "${c.title}"?`,
    body: `Its messages, map and ${c.connection_count} ${c.connection_count === 1 ? 'connection' : 'connections'} are deleted for good.`,
    action: 'Delete chat',
  });
  if (!ok) return;
  try {
    await request('DELETE', `/api/conversations/${c.id}`);
    chats = chats.filter((x) => x.id !== c.id);
    if (conversationId === c.id) {
      conversationId = null;
      clearView(); // the open map was this chat; don't save it back
      showIntro();
    }
    renderChats();
    toast('Chat deleted');
  } catch (err) {
    toast(`Couldn't delete: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

function renderAccount() {
  $('account-name').textContent = shell.user?.name || '—';
  $('account-email').textContent = shell.user?.email || '—';
}

const deleteForm = $('delete-form');
const deletePassword = $('delete-password');
const deleteConfirm = $('delete-confirm');
const deleteSubmit = $('delete-submit');
const deleteError = $('delete-error');

deleteForm.addEventListener('input', () => {
  deleteSubmit.disabled = !(deletePassword.value && deleteConfirm.value.trim() === 'DELETE');
  deleteError.hidden = true;
});

deleteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (deleteSubmit.disabled) return;
  deleteSubmit.disabled = true;
  deleteSubmit.textContent = 'Deleting…';
  try {
    const res = await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: deletePassword.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    location.assign('/');
  } catch (err) {
    deleteError.textContent = err.message;
    deleteError.hidden = false;
    deleteSubmit.textContent = 'Delete my account';
    deleteSubmit.disabled = false;
    deletePassword.select();
  }
});

// ---------------------------------------------------------------------------

loadUser().then(renderAccount);
route();
