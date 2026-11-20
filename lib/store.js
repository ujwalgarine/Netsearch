// Saved chats, map versions and connections. Every function takes the per-request Supabase
// client (acting as the signed-in user, so row level security applies) and the user's id,
// and every query also filters by user_id. A row the user doesn't own reads as "not found".

import { logEvent } from './auth.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isId = (id) => typeof id === 'string' && UUID_RE.test(id);
export const STATUSES = ['suggested', 'saved', 'contacted', 'replied', 'meeting_set', 'met'];

export class StoreError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

function check({ data, error }, what) {
  if (error) throw new StoreError(`Couldn't ${what}.`, error);
  return data;
}

const now = () => new Date().toISOString();

export async function listConversations(db, userId) {
  const rows = check(
    await db
      .from('conversations')
      .select('id, title, updated_at, connections(count)')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }),
    'load your chats',
  );
  return rows.map((r) => ({ id: r.id, title: r.title, updated_at: r.updated_at, connection_count: r.connections?.[0]?.count ?? 0 }));
}

export async function getConversation(db, userId, id) {
  if (!isId(id)) return null;
  return check(
    await db.from('conversations').select('id, title, created_at, updated_at').eq('user_id', userId).eq('id', id).maybeSingle(),
    'load this chat',
  );
}

// Messages, the latest map and the status of each connection, for reopening a chat.
export async function loadConversation(db, userId, id) {
  const conversation = await getConversation(db, userId, id);
  if (!conversation) return null;
  const [messages, map, connections] = await Promise.all([
    getMessages(db, userId, id),
    getLatestMap(db, userId, id),
    db.from('connections').select('id, person_key, status, notes, follow_up_on').eq('user_id', userId).eq('conversation_id', id),
  ]);
  const statuses = {};
  const tracked = {}; // person id -> { id, status, notes, follow_up_on }, for the map's person panel
  for (const c of check(connections, 'load connections')) {
    statuses[c.person_key] = c.status;
    tracked[c.person_key] = { id: c.id, status: c.status, notes: c.notes, follow_up_on: c.follow_up_on };
  }
  return { ...conversation, messages, map: map?.data_json ?? null, version: map?.version ?? 0, statuses, connections: tracked };
}

export async function getMessages(db, userId, conversationId) {
  return check(
    await db
      .from('messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .order('id', { ascending: true }),
    'load messages',
  );
}

export async function getLatestMap(db, userId, conversationId) {
  return check(
    await db
      .from('maps')
      .select('id, version, data_json')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'load the map',
  );
}

export async function createConversation(db, userId, title) {
  return check(
    await db.from('conversations').insert({ user_id: userId, title: cleanTitle(title) }).select('id, title').single(),
    'create a chat',
  );
}

export async function renameConversation(db, userId, id, title) {
  if (!isId(id)) return null;
  const rows = check(
    await db.from('conversations').update({ title: cleanTitle(title) }).eq('user_id', userId).eq('id', id).select('id, title, updated_at'),
    'rename this chat',
  );
  return rows[0] ?? null;
}

export async function deleteConversation(db, userId, id) {
  if (!isId(id)) return false;
  const rows = check(await db.from('conversations').delete().eq('user_id', userId).eq('id', id).select('id'), 'delete this chat');
  return rows.length > 0;
}

export async function touchConversation(db, userId, id) {
  check(await db.from('conversations').update({ updated_at: now() }).eq('user_id', userId).eq('id', id), 'update this chat');
}

export async function addMessages(db, userId, conversationId, messages) {
  check(
    await db.from('messages').insert(messages.map((m) => ({ user_id: userId, conversation_id: conversationId, role: m.role, content: m.content }))),
    'save the messages',
  );
}

// A planner turn: a new map version. Returns the version number.
export async function addMapVersion(db, userId, conversationId, map) {
  const latest = await getLatestMap(db, userId, conversationId);
  const version = (latest?.version ?? 0) + 1;
  check(
    await db.from('maps').insert({ user_id: userId, conversation_id: conversationId, version, goal: String(map.goal ?? ''), data_json: map }),
    'save the map',
  );
  await syncConnections(db, userId, conversationId, map);
  if (version === 1) await logEvent(db, userId, 'map_created', conversationId);
  return version;
}

// Manual edits and finished people searches: update the latest version in place.
export async function saveLatestMap(db, userId, conversationId, map) {
  const latest = await getLatestMap(db, userId, conversationId);
  if (!latest) return addMapVersion(db, userId, conversationId, map);
  check(
    await db.from('maps').update({ goal: String(map.goal ?? ''), data_json: map }).eq('user_id', userId).eq('id', latest.id),
    'save the map',
  );
  await syncConnections(db, userId, conversationId, map);
  return latest.version;
}

// Every person on the map is a connection. Re-saving refreshes their details but never their
// status or notes; people removed from the map are dropped only if nothing was done with them yet.
async function syncConnections(db, userId, conversationId, map) {
  const rows = [];
  const seen = new Set();
  for (const b of Array.isArray(map.branches) ? map.branches : []) {
    for (const p of Array.isArray(b.people) ? b.people : []) {
      const key = String(p.id ?? '').slice(0, 2000);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const role = roleOf(p);
      rows.push({
        user_id: userId,
        conversation_id: conversationId,
        person_key: key,
        name: String(p.name ?? '').slice(0, 200),
        profile_url: typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url.slice(0, 2000) : null,
        branch_label: String(b.label ?? '').slice(0, 200),
        title: role.title,
        organization: role.organization,
        why: String(p.why ?? '').slice(0, 2000),
        talking_points_json: Array.isArray(p.talking_points) ? p.talking_points.slice(0, 12).map(String) : [],
        search_query: String(b.query ?? '').slice(0, 1000),
      });
    }
  }
  if (rows.length) {
    check(await db.from('connections').upsert(rows, { onConflict: 'conversation_id,person_key' }), 'save connections');
  }
  let stale = db.from('connections').delete().eq('user_id', userId).eq('conversation_id', conversationId).eq('status', 'suggested');
  if (seen.size) stale = stale.not('person_key', 'in', `(${[...seen].map(pgQuote).join(',')})`);
  check(await stale, 'tidy connections');
}

// ---------------------------------------------------------------------------
// Connections: tracking outreach
// ---------------------------------------------------------------------------

export const CONNECTION_FIELDS =
  'id, conversation_id, person_key, name, profile_url, branch_label, title, organization, why, talking_points_json, search_query, status, notes, follow_up_on, status_updated_at, created_at';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Check a PATCH body. Returns { fields } or { error }.
export function connectionPatch(body) {
  const fields = {};
  if (body?.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { error: 'Unknown status.' };
    fields.status = body.status;
  }
  if (body?.notes !== undefined) {
    if (body.notes !== null && typeof body.notes !== 'string') return { error: 'Notes must be text.' };
    fields.notes = body.notes === null ? null : body.notes.slice(0, 5000);
  }
  if (body?.follow_up_on !== undefined) {
    const d = body.follow_up_on;
    if (d !== null && d !== '' && !(typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)))) {
      return { error: 'Follow-up date must be YYYY-MM-DD.' };
    }
    fields.follow_up_on = d || null;
  }
  if (!Object.keys(fields).length) return { error: 'Nothing to update.' };
  return { fields };
}

// Update one connection found by `match` ({ id } or { conversation_id, person_key }).
// A status change stamps status_updated_at and logs connection_status_changed.
async function updateConnectionWhere(db, userId, match, fields) {
  let find = db.from('connections').select('id, status').eq('user_id', userId);
  for (const [k, v] of Object.entries(match)) find = find.eq(k, v);
  const current = check(await find.maybeSingle(), 'find this connection');
  if (!current) return null;

  const changes = { ...fields };
  const statusChanged = fields.status !== undefined && fields.status !== current.status;
  if (fields.status !== undefined && !statusChanged) delete changes.status;
  if (statusChanged) changes.status_updated_at = now();

  let row;
  if (Object.keys(changes).length) {
    const rows = check(
      await db.from('connections').update(changes).eq('user_id', userId).eq('id', current.id).select(CONNECTION_FIELDS),
      'update this connection',
    );
    row = rows[0];
  } else {
    row = check(await db.from('connections').select(CONNECTION_FIELDS).eq('user_id', userId).eq('id', current.id).single(), 'load this connection');
  }
  if (statusChanged) await logEvent(db, userId, 'connection_status_changed', current.id);
  return row ?? null;
}

export async function updateConnection(db, userId, id, fields) {
  if (!isId(id)) return null;
  return updateConnectionWhere(db, userId, { id }, fields);
}

export async function updatePersonConnection(db, userId, conversationId, personKey, fields) {
  if (!isId(conversationId) || !personKey) return null;
  return updateConnectionWhere(db, userId, { conversation_id: conversationId, person_key: String(personKey) }, fields);
}

// Kept for the map's original "Save connection" call.
export async function setConnectionStatus(db, userId, conversationId, personKey, status) {
  if (!STATUSES.includes(status)) return null;
  return updatePersonConnection(db, userId, conversationId, personKey, { status });
}

// Filters: status ('tracked' = everything but suggested [default], 'all', or one status),
// branch (exact label), conversation (id), q (name, title or organization contains).
export async function listConnections(db, userId, { status = 'tracked', branch = '', conversation = '', q = '' } = {}) {
  let query = db
    .from('connections')
    .select(`${CONNECTION_FIELDS}, conversations(title)`)
    .eq('user_id', userId)
    .order('status_updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(2000);
  if (status === 'tracked' || !status) query = query.neq('status', 'suggested');
  else if (status !== 'all') {
    if (!STATUSES.includes(status)) return [];
    query = query.eq('status', status);
  }
  if (branch) query = query.eq('branch_label', String(branch));
  if (conversation) {
    if (!isId(conversation)) return [];
    query = query.eq('conversation_id', conversation);
  }
  const term = String(q ?? '').trim().slice(0, 100);
  if (term) {
    const v = pgQuote(`*${term}*`);
    query = query.or(`name.ilike.${v},title.ilike.${v},organization.ilike.${v}`);
  }
  const rows = check(await query, 'load your connections');
  return rows.map(({ conversations, ...r }) => ({ ...r, conversation_title: conversations?.title ?? '' }));
}

// Options for the filters: every branch and conversation that has connections.
export async function connectionFacets(db, userId) {
  const rows = check(
    await db.from('connections').select('branch_label, conversation_id, status, conversations(title)').eq('user_id', userId).limit(5000),
    'load filters',
  );
  const branches = [...new Set(rows.map((r) => r.branch_label).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const convos = new Map();
  for (const r of rows) if (!convos.has(r.conversation_id)) convos.set(r.conversation_id, r.conversations?.title ?? 'Untitled map');
  return {
    branches,
    conversations: [...convos].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title)),
    suggested: rows.filter((r) => r.status === 'suggested').length,
  };
}

// ---------------------------------------------------------------------------
// One person on a map (Work and projects, lib/work.js)
// ---------------------------------------------------------------------------

// A connection plus the full person behind it on the latest map, and that map's goal and
// "about you". `person` is null if they have since been taken off the map.
export async function connectionPerson(db, userId, connectionId) {
  if (!isId(connectionId)) return null;
  const connection = check(
    await db.from('connections').select(CONNECTION_FIELDS).eq('user_id', userId).eq('id', connectionId).maybeSingle(),
    'load this connection',
  );
  if (!connection) return null;
  const map = (await getLatestMap(db, userId, connection.conversation_id))?.data_json ?? null;
  return { connection, person: findPerson(map, connection.person_key), goal: String(map?.goal ?? ''), about: String(map?.profile ?? '') };
}

// A person on a chat's latest map (by their id on the map), with the map's goal and "about you".
export async function mapPerson(db, userId, conversationId, personKey) {
  if (!isId(conversationId) || !personKey) return null;
  const map = (await getLatestMap(db, userId, conversationId))?.data_json ?? null;
  const person = findPerson(map, personKey);
  return person ? { person, goal: String(map.goal ?? ''), about: String(map.profile ?? '') } : null;
}

function findPerson(map, key) {
  for (const b of Array.isArray(map?.branches) ? map.branches : []) {
    const person = (Array.isArray(b.people) ? b.people : []).find((p) => p?.id === key);
    if (person && typeof person === 'object') return person;
  }
  return null;
}
// "Product Manager at Microsoft" -> { title, organization }, preferring the current job on the profile.
function roleOf(p) {
  const current = Array.isArray(p.experience) ? p.experience.find((x) => x && !x.to) : null;
  if (current?.title || current?.company) {
    return { title: String(current.title ?? '').slice(0, 200), organization: String(current.company ?? '').slice(0, 200) };
  }
  const headline = String(p.headline ?? '');
  const at = headline.lastIndexOf(' at ');
  return at > 0
    ? { title: headline.slice(0, at).slice(0, 200), organization: headline.slice(at + 4).slice(0, 200) }
    : { title: headline.slice(0, 200), organization: '' };
}

// PostgREST "in" lists: wrap each value in double quotes, escaping \ and ".
const pgQuote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const cleanTitle = (t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled map';
