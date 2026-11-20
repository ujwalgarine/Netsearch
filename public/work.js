// Work and projects: a person's own public work (repos, projects, papers, roles, their site),
// looked up on the server (lib/enrich.js) only through accounts they linked themselves, and kept
// on the map with the person. Shown in the map's person panel and on the Connections page.
// Uses app.js globals: state, undoStack, viewSeq, conversationId, findBranch, flushSave, save,
// putMap, snapshot, commit, post, el, button, iconButton, toast, copyText, $.

const WORK_TTL_MS = 30 * 86_400_000; // looked up again after 30 days
const WORK_KIND = { repo: 'Repo', project: 'Project', paper: 'Paper', role: 'Role', site: 'Website' };
const workBusy = new Set();   // person ids being looked up
const workErrors = new Map(); // person id -> message from the last try
let workTimer = 0;

const workStale = (w) => !w || !Number.isFinite(Date.parse(w.fetched_at)) || Date.now() - Date.parse(w.fetched_at) > WORK_TTL_MS;
const findPersonOnMap = (map, id) => map?.branches.flatMap((b) => b.people).find((p) => p.id === id) ?? null;

function fmtWorkDate(d) {
  if (!d) return '';
  if (/^\d{4}$/.test(d)) return d;
  const t = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

// Called whenever a person's panel opens. Looks up once the panel stays on them for a moment,
// so stepping through people with the arrow keys costs nothing.
function maybeLookupWork(branchId, person) {
  clearTimeout(workTimer);
  if (!conversationId || (!person.url && !String(person.id).startsWith('demo-'))) return;
  if (!workStale(person.work) || workBusy.has(person.id) || workErrors.has(person.id)) return;
  workTimer = setTimeout(() => {
    if (state.view?.kind === 'person' && state.view.personId === person.id) lookupWork(branchId, person.id);
  }, 900);
}

async function lookupWork(branchId, personId) {
  const p = findBranch(branchId)?.people.find((x) => x.id === personId);
  if (!p || !conversationId || workBusy.has(personId)) return;
  const cid = conversationId;
  const seq = viewSeq;
  const startMap = state.map;
  const sent = JSON.stringify(p.work?.blocked ?? []);
  workBusy.add(personId);
  workErrors.delete(personId);
  paintWork(personId);

  let work = null;
  try {
    await flushSave(); // the server reads the person (and their "Not them" list) from the saved map
    ({ work } = await post('/api/people/work', { conversationId: cid, personKey: personId }));
  } catch (err) {
    workErrors.set(personId, err.message || 'The lookup failed.');
  }
  workBusy.delete(personId);

  if (work) {
    // Skip copies whose "Not them" list changed meanwhile (an undo, or another removal).
    const apply = (map) => {
      const x = findPersonOnMap(map, personId);
      if (x && JSON.stringify(x.work?.blocked ?? []) === sent) x.work = structuredClone(work);
    };
    if (seq !== viewSeq) {
      apply(startMap);
      putMap(cid, startMap);
      return;
    }
    for (const map of [state.map, ...undoStack]) apply(map);
    save();
  }
  paintWork(personId);
}

// "Not them": drop everything from that account (or that one link), never add it for this person
// again, and rebuild the openers without it. Undoable like any other edit.
function notThem(branchId, personId, item) {
  const p = findBranch(branchId)?.people.find((x) => x.id === personId);
  if (!p?.work) return;
  snapshot();
  const w = p.work;
  const key = item.account || item.url;
  const removed = w.items.filter((x) => (x.account || x.url) === key);
  w.blocked = [...new Set([...(w.blocked ?? []), key])].slice(-50);
  w.items = w.items.filter((x) => !removed.includes(x));
  w.accounts = (w.accounts ?? []).filter((a) => a.url !== key);
  w.talking_points = (w.talking_points ?? []).filter((t) => !removed.some((x) => t.includes(x.title)));
  w.themes = [];
  commit();
  paintWork(personId);
  toast(removed.length > 1 ? `Removed ${removed.length} items from that account` : 'Removed', { undoable: true });
  if (w.items.length) lookupWork(branchId, personId);
}

// Repaint the open panel's Work tab and the openers on the Prep tab, without touching the rest
// (the tracker's notes may be mid-edit).
function paintWork(personId) {
  const v = state.view;
  if (v?.kind !== 'person' || v.personId !== personId) return;
  const p = findBranch(v.branchId)?.people.find((x) => x.id === personId);
  if (!p) return;
  $('work-panel')?.replaceChildren(...workPanelContent(v.branchId, p));
  $('prep-work')?.replaceChildren(...workPrepContent(p));
  const tab = $('tab-work');
  if (tab) tab.textContent = p.work?.items?.length ? `Work · ${p.work.items.length}` : 'Work';
}

function workPanelContent(branchId, p) {
  const out = [el('p', 'work-intro', "Their own public work, from accounts tied to their profile. Each item says where it came from and how we know it's theirs.")];
  const w = p.work;
  const busy = workBusy.has(p.id);
  const error = workErrors.get(p.id);
  if (busy) out.push(el('p', 'status-line loading', w ? 'Updating…' : 'Looking for their public work…'));
  if (error && !busy) {
    out.push(el('p', 'status-line error', error));
    out.push(button('Try again', 'pill pill-ghost sm work-action', () => lookupWork(branchId, p.id)));
  }
  if (!w) {
    if (!busy && !error) {
      if (!p.url && !String(p.id).startsWith('demo-')) out.push(el('p', 'why', 'There is no profile link to start from.'));
      else out.push(button('Find their work', 'pill pill-ghost sm work-action', () => lookupWork(branchId, p.id)));
    }
    return out;
  }
  if (w.opted_out) {
    out.push(el('p', 'why', 'This person asked not to have their work collected.'));
    return out;
  }
  if (w.demo) out.push(el('p', 'work-note', 'Demo data. With EXA_API_KEY set, this shows their real work.'));
  if (w.items?.length) out.push(workList(w, { onNotThem: (item) => notThem(branchId, p.id, item) }));
  else out.push(el('p', 'why', 'Nothing public found from accounts they linked.'));
  if (w.skipped?.length) {
    out.push(el('p', 'work-note', `Left out ${w.skipped.length === 1 ? 'a linked account' : `${w.skipped.length} linked accounts`} that didn't look like them.`));
  }
  if (w.notes?.length) {
    const what = { Profile: 'their profile page', Website: 'their website', 'Talking points': 'the openers' };
    const names = [...new Set(w.notes.map((n) => n.split(':')[0]))].map((n) => what[n] ?? n);
    out.push(el('p', 'work-note', `Couldn't read ${names.join(' or ')} this time, so this may be incomplete. Check again later.`));
  }
  const foot = el('div', 'work-foot');
  const when = fmtWorkDate(w.fetched_at);
  foot.append(el('span', null, when ? `Checked ${new Date(w.fetched_at).toLocaleDateString()}` : ''));
  if (!busy) foot.append(button('Check again', 'work-refresh', () => lookupWork(branchId, p.id)));
  out.push(foot);
  return out;
}

// The list itself. onNotThem is left out where items can't be changed (the Connections page).
function workList(w, { onNotThem } = {}) {
  const confirmed = new Set((w.accounts ?? []).filter((a) => a.confirmed).map((a) => a.url));
  const ul = el('ul', 'work-list');
  for (const it of w.items ?? []) {
    const li = el('li', 'work-item');
    const meta = el('p', 'work-meta');
    meta.append(el('span', 'work-kind', WORK_KIND[it.kind] ?? 'Work'), el('span', null, [it.source, fmtWorkDate(it.date)].filter(Boolean).join(' · ')));
    let title;
    if (/^https?:\/\//.test(it.url ?? '')) {
      title = el('a', 'work-title', it.title);
      title.href = it.url;
      title.target = '_blank';
      title.rel = 'noopener noreferrer';
    } else {
      title = el('span', 'work-title', it.title);
    }
    li.append(meta, title);
    if (it.detail) li.append(el('p', 'work-detail', it.detail));
    const linksBack = confirmed.has(it.account) && !/links back/i.test(it.via ?? '');
    li.append(el('p', 'work-via', `${it.via}${linksBack ? ' · links back to them' : ''}`));
    if (onNotThem) {
      const nt = button('Not them', 'work-not', () => onNotThem(it));
      nt.title = "Remove this and don't add it for this person again";
      li.append(nt);
    }
    ul.append(li);
  }
  return ul;
}

// Openers written from their work, under the profile's own talking points.
function workPrepContent(p) {
  const points = p.work?.talking_points ?? [];
  if (!points.length) return [];
  const ol = el('ol', 'points');
  for (const t of points) {
    const li = el('li');
    li.append(el('span', 'point-text', t), iconButton('copy', 'Copy talking point', () => copyText(t), 'copy'));
    ol.append(li);
  }
  return [el('h3', null, 'From their work'), ol];
}
