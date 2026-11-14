// Insights: analytics computed only from the user's own rows, and networking tips built
// from a compact summary of their network (cached in tips_cache by a hash of that summary).

import crypto from 'node:crypto';
import { StoreError } from './store.js';

export const PIPELINE = ['saved', 'contacted', 'replied', 'meeting_set', 'met'];
const STAGE_LABEL = { saved: 'Saved', contacted: 'Contacted', replied: 'Replied', meeting_set: 'Meeting set', met: 'Met' };
const OUTREACH = ['contacted', 'replied', 'meeting_set', 'met'];
const REPLIED = ['replied', 'meeting_set', 'met'];
const WEEKS = 12;
const STALE_DAYS = 7;
const DAY = 864e5;

function check({ data, error }, what) {
  if (error) throw new StoreError(`Couldn't ${what}.`, error);
  return data;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const todayOr = (s) => (typeof s === 'string' && DATE_RE.test(s) ? s : new Date().toISOString().slice(0, 10));

async function loadRows(db, userId) {
  const since = new Date(startOfWeek(new Date()).getTime() - (WEEKS - 1) * 7 * DAY).toISOString();
  const [connections, events, mapsCreated, practice] = await Promise.all([
    db
      .from('connections')
      .select('id, conversation_id, name, title, organization, branch_label, status, follow_up_on, status_updated_at, created_at')
      .eq('user_id', userId)
      .limit(5000),
    db.from('events').select('type, created_at').eq('user_id', userId).gte('created_at', since).limit(10000),
    db.from('events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('type', 'map_created'),
    db.from('practice_sessions').select('status, score').eq('user_id', userId).limit(5000),
  ]);
  return {
    connections: check(connections, 'load your connections'),
    events: check(events, 'load your activity'),
    mapsCreated: (check(mapsCreated, 'count your maps'), mapsCreated.count ?? 0),
    practice: check(practice, 'load your practice sessions'),
  };
}

// Monday 00:00 UTC of the week containing `d`.
function startOfWeek(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

function topCounts(values, n, { other = true } = {}) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted.slice(0, n).map(([label, count]) => ({ label, count }));
  const rest = sorted.slice(n).reduce((sum, [, c]) => sum + c, 0);
  if (other && rest) top.push({ label: 'Other', count: rest, other: true });
  return top;
}

const daysBetween = (fromIso, toMs) => Math.floor((toMs - new Date(fromIso).getTime()) / DAY);

// GET /api/insights/summary
export async function insightsSummary(db, userId, { today: todayParam } = {}) {
  const today = todayOr(todayParam);
  const { connections, events, mapsCreated, practice } = await loadRows(db, userId);
  const nowMs = Date.now();

  const tracked = connections.filter((c) => c.status !== 'suggested');
  const at = (statuses) => tracked.filter((c) => statuses.includes(c.status)).length;
  const reachedOut = at(OUTREACH);
  const replied = at(REPLIED);
  const practiceCompleted = practice.filter((p) => p.status === 'completed').length;

  // Funnel: how many reached each stage (a connection at "replied" has also been saved and contacted).
  const funnel = PIPELINE.map((stage, i) => ({
    stage,
    label: STAGE_LABEL[stage],
    reached: at(PIPELINE.slice(i)),
    current: at([stage]),
  }));
  funnel.forEach((f, i) => {
    const prev = funnel[i - 1];
    f.conversion = i === 0 || !prev.reached ? null : f.reached / prev.reached;
  });

  // Activity: last 12 weeks, from the events log.
  const first = startOfWeek(new Date(nowMs - (WEEKS - 1) * 7 * DAY));
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    start: new Date(first.getTime() + i * 7 * DAY).toISOString().slice(0, 10),
    maps: 0,
    outreach: 0,
    practice: 0,
  }));
  const series = { map_created: 'maps', connection_status_changed: 'outreach', practice_completed: 'practice' };
  for (const e of events) {
    const key = series[e.type];
    if (!key) continue;
    const i = Math.floor((new Date(e.created_at).getTime() - first.getTime()) / (7 * DAY));
    if (i >= 0 && i < WEEKS) weeks[i][key] += 1;
  }

  // Follow-ups due: a follow-up date today or earlier, or "contacted" for a week with no reply.
  const followups = [];
  for (const c of tracked) {
    const base = { id: c.id, conversation_id: c.conversation_id, name: c.name, title: c.title, organization: c.organization, status: c.status };
    if (c.follow_up_on && c.follow_up_on <= today) {
      followups.push({ ...base, reason: 'follow_up', follow_up_on: c.follow_up_on, days: daysBetween(`${c.follow_up_on}T00:00:00Z`, Date.parse(`${today}T00:00:00Z`)) });
    } else if (c.status === 'contacted' && c.status_updated_at && daysBetween(c.status_updated_at, nowMs) >= STALE_DAYS) {
      followups.push({ ...base, reason: 'stale', days: daysBetween(c.status_updated_at, nowMs) });
    }
  }
  followups.sort((a, b) => b.days - a.days);

  return {
    today,
    kpis: {
      maps_created: mapsCreated,
      connections_saved: tracked.length,
      reached_out: reachedOut,
      replied,
      reply_rate: reachedOut ? replied / reachedOut : null,
      met: at(['met']),
      practice_completed: practiceCompleted,
    },
    funnel,
    mix: {
      total: tracked.length,
      branches: topCounts(tracked.map((c) => c.branch_label || 'No branch'), 8),
      organizations: topCounts(tracked.map((c) => c.organization).filter(Boolean), 8, { other: false }),
    },
    activity: { weeks },
    followups: followups.slice(0, 50),
  };
}

// ---------------------------------------------------------------------------
// Tips
// ---------------------------------------------------------------------------

// The compact network summary the tips are written from (and hashed for the cache).
export async function tipsSummary(db, userId) {
  const { connections, practice } = await loadRows(db, userId);
  const nowMs = Date.now();
  const tracked = connections.filter((c) => c.status !== 'suggested');

  const byStatus = Object.fromEntries(['suggested', ...PIPELINE].map((s) => [s, connections.filter((c) => c.status === s).length]));
  const byBranch = topCounts(tracked.map((c) => c.branch_label || 'No branch'), 8);
  const byOrg = topCounts(tracked.map((c) => c.organization).filter(Boolean), 8, { other: false });

  const branchesAll = new Set(connections.map((c) => c.branch_label).filter(Boolean));
  const branchesTracked = new Set(tracked.map((c) => c.branch_label).filter(Boolean));
  const emptyBranches = [...branchesAll].filter((b) => !branchesTracked.has(b)).sort().slice(0, 8);

  const stale = tracked
    .filter((c) => c.status === 'contacted' && c.status_updated_at && daysBetween(c.status_updated_at, nowMs) >= STALE_DAYS)
    .map((c) => ({ id: c.id, name: c.name, organization: c.organization, days_since_contacted: daysBetween(c.status_updated_at, nowMs) }))
    .sort((a, b) => b.days_since_contacted - a.days_since_contacted)
    .slice(0, 5);

  const topOrg = byOrg[0];
  const scores = practice.map((p) => p.score).filter((s) => typeof s === 'number');

  const goals = check(
    await db.from('maps').select('conversation_id, goal, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(60),
    'load your maps',
  );
  const recentGoals = [];
  const seen = new Set();
  for (const m of goals) {
    if (seen.has(m.conversation_id) || !m.goal) continue;
    seen.add(m.conversation_id);
    recentGoals.push(m.goal);
    if (recentGoals.length === 3) break;
  }

  return {
    saved_total: tracked.length,
    by_status: byStatus,
    by_branch: byBranch.map(({ label, count }) => ({ label, count })),
    by_organization: byOrg.map(({ label, count }) => ({ label, count })),
    top_organization_share: topOrg && tracked.length ? { organization: topOrg.label, count: topOrg.count, of: tracked.length } : null,
    stale_contacts: stale,
    branches_with_no_saved_connections: emptyBranches,
    practice: scores.length ? { sessions_scored: scores.length, average_score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 } : null,
    recent_goals: recentGoals,
    // People the tips may point to (ids are checked against this list).
    saved_sample: tracked
      .slice()
      .sort((a, b) => PIPELINE.indexOf(b.status) - PIPELINE.indexOf(a.status))
      .slice(0, 10)
      .map((c) => ({ id: c.id, name: c.name, organization: c.organization, branch: c.branch_label, status: c.status })),
  };
}

export const hashSummary = (summary, mode) =>
  crypto.createHash('sha256').update(JSON.stringify({ v: 1, mode, summary })).digest('hex');

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Fewer than 3 saved connections: no model call, three fixed tips that point to the map.
export function starterTips(summary) {
  const n = summary.saved_total;
  const have = `You have ${plural(n, 'saved connection')}`;
  return [
    {
      title: 'Save the people worth a message',
      body: 'Open a map, click a person, and set them to Saved. Tips here are written from the people you choose to track.',
      based_on: `${have}; personalised tips start at 3.`,
      action: { type: 'new_map', connection_id: null, label: 'Open a map' },
    },
    {
      title: 'Start with one branch',
      body: 'Pick the branch closest to your goal and save two or three people from it before moving to the next.',
      based_on: summary.recent_goals[0] ? `Your latest map: "${summary.recent_goals[0]}".` : 'You have no maps yet.',
      action: { type: 'new_map', connection_id: null, label: summary.recent_goals[0] ? 'Go to maps' : 'Create a map' },
    },
    {
      title: 'Track each message you send',
      body: 'When you reach out, move the person to Contacted. Your funnel and follow-up reminders build from those changes.',
      based_on: `${plural(summary.by_status.contacted ?? 0, 'connection')} marked Contacted so far.`,
      action: { type: 'none', connection_id: null, label: '' },
    },
  ];
}

// No OpenAI key: deterministic tips built from the same summary.
export function demoTips(summary) {
  const tips = [];
  const s = summary;
  const reached = OUTREACH.reduce((n, k) => n + (s.by_status[k] ?? 0), 0);
  const replied = REPLIED.reduce((n, k) => n + (s.by_status[k] ?? 0), 0);

  if (s.top_organization_share && s.top_organization_share.count >= 2 && s.top_organization_share.count / s.top_organization_share.of >= 0.5) {
    const t = s.top_organization_share;
    tips.push({
      title: `Look beyond ${t.organization}`,
      body: `Most of your tracked people work at one place. Add a branch for a second company so one slow team doesn't stall your search.`,
      based_on: `${t.count} of your ${t.of} saved connections are at ${t.organization}.`,
      action: { type: 'new_map', connection_id: null, label: 'Add a map' },
    });
  }
  for (const c of s.stale_contacts.slice(0, 2)) {
    tips.push({
      title: `Follow up with ${c.name}`,
      body: 'A short, specific nudge a week after the first message often gets the reply. Mention one thing from their profile.',
      based_on: `${c.name} has been in Contacted for ${c.days_since_contacted} days.`,
      action: { type: 'open_connection', connection_id: c.id, label: 'Open connection' },
    });
  }
  if (s.saved_total > 0 && reached === 0 && s.saved_sample[0]) {
    tips.push({
      title: 'Send the first message',
      body: `Start with ${s.saved_sample[0].name}: open their talking points and send a two-line note today.`,
      based_on: `You've saved ${plural(s.saved_total, 'connection')} and contacted none yet.`,
      action: { type: 'open_connection', connection_id: s.saved_sample[0].id, label: `Open ${s.saved_sample[0].name}` },
    });
  }
  if (replied > 0 && !s.practice) {
    const who = s.saved_sample.find((c) => REPLIED.includes(c.status));
    tips.push({
      title: 'Rehearse before the chat',
      body: 'Someone replied. Run a practice coffee chat so your first questions come out naturally.',
      based_on: `${plural(replied, 'connection')} replied or moved further.`,
      action: { type: 'practice', connection_id: who?.id ?? null, label: 'Practice' },
    });
  }
  if (s.branches_with_no_saved_connections[0]) {
    const b = s.branches_with_no_saved_connections[0];
    tips.push({
      title: `Revisit "${b}"`,
      body: 'This branch has people on your map but none saved. Either save one worth messaging or drop the branch to keep the map focused.',
      based_on: `Your "${b}" branch has no saved connections.`,
      action: { type: 'none', connection_id: null, label: '' },
    });
  }
  if (tips.length < 3) {
    tips.push({
      title: 'Keep the pipeline moving',
      body: 'Move each person forward as things happen. Replies, meetings and coffee chats all feed your insights.',
      based_on: `${plural(s.saved_total, 'saved connection')}, ${reached} reached out, ${replied} replied.`,
      action: { type: 'none', connection_id: null, label: '' },
    });
  }
  if (tips.length < 3 && s.recent_goals[0]) {
    tips.push({
      title: 'Widen your latest map',
      body: 'Ask the map for one more branch built on a shared tie (school, hometown or past employer).',
      based_on: `Your latest map: "${s.recent_goals[0]}".`,
      action: { type: 'new_map', connection_id: null, label: 'Open maps' },
    });
  }
  if (tips.length < 3 && s.by_branch[0]) {
    tips.push({
      title: `Go deeper in "${s.by_branch[0].label}"`,
      body: 'Your strongest branch is a good place to ask for introductions to the next person.',
      based_on: `${plural(s.by_branch[0].count, 'saved connection')} in "${s.by_branch[0].label}".`,
      action: { type: 'none', connection_id: null, label: '' },
    });
  }
  return tips.slice(0, 6);
}

const TIPS_PROMPT = `You write networking tips inside a networking app, for one specific user.
You get a JSON summary of that user's own network: counts by status, branch and organization,
stale contacts, branches with no saved connections, the share of one organization, practice scores and recent goals.

Rules:
- Return 3 to 6 tips.
- Every tip must come from this user's data. NEVER give generic advice that would apply to anyone
  (e.g. "personalize your messages", "be yourself", "follow up politely") unless it is tied to a specific number or person in the summary.
- based_on must quote the specific data point that triggered the tip, with its numbers or names,
  e.g. "3 of your 4 saved connections are at Microsoft" or "Priya Shah has been in Contacted for 9 days".
- Use only facts in the summary. Do not invent people, companies, numbers or outcomes.
- Status meanings: saved (picked, not contacted), contacted (message sent), replied, meeting_set, met (coffee chat happened).
- action.type: "open_connection" (connection_id must be an id from stale_contacts or saved_sample), "practice" (rehearse a coffee chat;
  connection_id from saved_sample or null), "new_map" (create or widen a map), or "none". label is 2-4 words, or "" for none.
- Titles under 8 words. Bodies 1-2 sentences, concrete next step.`;

const tipsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tips'],
  properties: {
    tips: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'body', 'based_on', 'action'],
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          based_on: { type: 'string', description: 'The specific data point from the summary that triggered this tip, quoted with its numbers or names' },
          action: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'connection_id', 'label'],
            properties: {
              type: { type: 'string', enum: ['open_connection', 'practice', 'new_map', 'none'] },
              connection_id: { type: ['string', 'null'] },
              label: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

export async function llmTips(openai, model, summary) {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: TIPS_PROMPT },
      { role: 'user', content: `Network summary:\n${JSON.stringify(summary)}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'networking_tips', strict: true, schema: tipsSchema } },
  });
  const message = completion.choices[0]?.message;
  if (message?.refusal) throw Object.assign(new Error(message.refusal), { status: 422 });
  return JSON.parse(message.content).tips;
}

// Keep only well-formed tips whose actions point at the user's own connections.
export function cleanTips(tips, summary) {
  const ids = new Set([...summary.stale_contacts, ...summary.saved_sample].map((c) => c.id));
  const types = ['open_connection', 'practice', 'new_map', 'none'];
  return (Array.isArray(tips) ? tips : [])
    .filter((t) => t && t.title && t.body && t.based_on)
    .slice(0, 6)
    .map((t) => {
      let { type, connection_id: id, label } = t.action ?? {};
      if (!types.includes(type)) type = 'none';
      if (id && !ids.has(id)) id = null;
      if (type === 'open_connection' && !id) type = 'none';
      return {
        title: String(t.title).slice(0, 120),
        body: String(t.body).slice(0, 600),
        based_on: String(t.based_on).slice(0, 300),
        action: { type, connection_id: id ?? null, label: type === 'none' ? '' : String(label || '').slice(0, 40) },
      };
    });
}

// POST /api/insights/tips: cached by the hash of the summary.
export async function getTips(db, userId, { openai, model }) {
  const summary = await tipsSummary(db, userId);
  if (summary.saved_total < 3) return { tips: starterTips(summary), source: 'starter', cached: false };

  const source = openai ? 'llm' : 'demo';
  const hash = hashSummary(summary, openai ? `llm:${model}` : 'demo');
  const cached = check(await db.from('tips_cache').select('input_hash, tips_json, created_at').eq('user_id', userId).maybeSingle(), 'load your tips');
  if (cached?.input_hash === hash && Array.isArray(cached.tips_json?.tips)) {
    return { tips: cached.tips_json.tips, source: cached.tips_json.source ?? source, cached: true, generated_at: cached.created_at };
  }

  let tips = cleanTips(source === 'llm' ? await llmTips(openai, model, summary) : demoTips(summary), summary);
  if (tips.length < 3) tips = [...tips, ...cleanTips(demoTips(summary), summary)].slice(0, Math.max(3, tips.length));
  const generatedAt = new Date().toISOString();
  check(
    await db.from('tips_cache').upsert({ user_id: userId, input_hash: hash, tips_json: { source, tips }, created_at: generatedAt }, { onConflict: 'user_id' }),
    'save your tips',
  );
  return { tips, source, cached: false, generated_at: generatedAt };
}
