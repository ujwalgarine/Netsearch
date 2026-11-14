// Connections and Insights API tests. Same setup as api.test.js: a demo-mode server on a random
// port against the Supabase project in .env, with throwaway users deleted at the end.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { configured, makeEmail, signUp as signUpAs, deleteAccounts, startServer } from './helpers.js';

let server;
const created = [];
const email = makeEmail('ins');
const signUp = (who) => signUpAs(email(who), created, `Test ${who}`);

const PEOPLE = [
  { key: 'p1', name: 'Ana Ortiz', headline: 'Product Manager at Microsoft', status: 'saved' },
  { key: 'p2', name: 'Ben Cho', headline: 'Program Manager at Microsoft', status: 'contacted' },
  { key: 'p3', name: 'Cara Diaz', headline: 'Designer at Microsoft', status: 'contacted' },
  { key: 'p4', name: 'Dev Patel', headline: 'Engineer at Google', status: 'replied' },
  { key: 'p5', name: 'Eli Fox', headline: 'Recruiter at Amazon', status: 'meeting_set' },
  { key: 'p6', name: 'Fay Gu', headline: 'PM at Microsoft', status: 'met' },
  { key: 'p7', name: 'Gus Hall', headline: 'Analyst at Meta', status: 'suggested' },
].map((p) => ({ ...p, id: `https://example.com/in/${p.key}` }));

// A map whose first branch holds all the people above, saved through the API.
async function seedMap(client, message = 'PM internship at Microsoft') {
  const turn = await client.post('/api/network', { message });
  assert.equal(turn.status, 200, turn.text);
  const id = turn.json.conversationId;
  const map = (await client.get(`/api/conversations/${id}`)).json.map;
  map.branches[0].people = PEOPLE.map((p) => ({ id: p.id, name: p.name, headline: p.headline, url: p.id, why: 'Shared school', talking_points: ['Ask about the team'] }));
  const put = await client.put(`/api/conversations/${id}/map`, { map });
  assert.equal(put.status, 200, put.text);
  return { conversationId: id, branch: map.branches[0].label };
}

async function connectionIdsByKey(client) {
  const all = await client.get('/api/connections?status=all');
  assert.equal(all.status, 200, all.text);
  return Object.fromEntries(all.json.connections.map((c) => [c.person_key, c.id]));
}

describe('Connections & Insights API', { skip: configured ? false : 'SUPABASE_URL / SUPABASE_ANON_KEY not set in .env' }, () => {
  let a;
  let b;
  let ids;
  let seeded;

  before(async () => {
    ({ child: server } = await startServer());
    ({ client: a } = await signUp('a'));
    ({ client: b } = await signUp('b'));
  });

  after(async () => {
    await deleteAccounts(created);
    server?.kill();
  });

  test('a brand-new user gets zeros and empty lists, not errors', async () => {
    const res = await b.get('/api/insights/summary');
    assert.equal(res.status, 200, res.text);
    const s = res.json;
    assert.deepEqual(s.kpis, { maps_created: 0, connections_saved: 0, reached_out: 0, replied: 0, reply_rate: null, met: 0, practice_completed: 0 });
    assert.ok(s.funnel.every((f) => f.reached === 0 && f.current === 0));
    assert.deepEqual(s.mix.branches, []);
    assert.deepEqual(s.mix.organizations, []);
    assert.equal(s.activity.weeks.length, 12);
    assert.ok(s.activity.weeks.every((w) => w.maps === 0 && w.outreach === 0 && w.practice === 0));
    assert.deepEqual(s.followups, []);

    const list = await b.get('/api/connections?facets=1');
    assert.deepEqual(list.json.connections, []);
    assert.deepEqual(list.json.facets.branches, []);
  });

  test('the reply rate is null when nothing has been contacted', async () => {
    seeded = await seedMap(a);
    ids = await connectionIdsByKey(a);
    await a.patch(`/api/connections/${ids[PEOPLE[0].id]}`, { status: 'saved' });
    const s = (await a.get('/api/insights/summary')).json;
    assert.equal(s.kpis.connections_saved, 1);
    assert.equal(s.kpis.reached_out, 0);
    assert.equal(s.kpis.reply_rate, null);
  });

  test('PATCH status updates status_updated_at and logs an event', async () => {
    const id = ids[PEOPLE[1].id];
    const res = await a.patch(`/api/connections/${id}`, { status: 'contacted' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.status, 'contacted');
    assert.ok(res.json.status_updated_at);

    const { data: events, error } = await a.db().from('events').select('type, ref_id').eq('type', 'connection_status_changed').eq('ref_id', id);
    assert.equal(error, null);
    assert.equal(events.length, 1);

    // Same status again: no new event. Notes and follow-up alone: no event either.
    await a.patch(`/api/connections/${id}`, { status: 'contacted' });
    const notes = await a.patch(`/api/connections/${id}`, { notes: 'Sent a note on LinkedIn', follow_up_on: '2026-01-05' });
    assert.equal(notes.status, 200);
    assert.equal(notes.json.notes, 'Sent a note on LinkedIn');
    assert.equal(notes.json.follow_up_on, '2026-01-05');
    const { data: after } = await a.db().from('events').select('id').eq('type', 'connection_status_changed').eq('ref_id', id);
    assert.equal(after.length, 1);
  });

  test('PATCH validates its fields', async () => {
    const id = ids[PEOPLE[1].id];
    assert.equal((await a.patch(`/api/connections/${id}`, { status: 'best_friends' })).status, 400);
    assert.equal((await a.patch(`/api/connections/${id}`, { follow_up_on: 'next tuesday' })).status, 400);
    assert.equal((await a.patch(`/api/connections/${id}`, {})).status, 400);
  });

  test("user B can't read or PATCH user A's connection (404)", async () => {
    const id = ids[PEOPLE[1].id];
    assert.equal((await b.patch(`/api/connections/${id}`, { status: 'met' })).status, 404);
    assert.equal((await b.patch(`/api/connections/${id}`, { notes: 'mine' })).status, 404);
    assert.equal((await b.get('/api/connections?status=all')).json.connections.length, 0);
    const own = await a.get('/api/connections?status=all');
    assert.equal(own.json.connections.find((c) => c.id === id).status, 'contacted');
  });

  test('GET /api/connections filters by status, branch, conversation and search', async () => {
    for (const p of PEOPLE.slice(2)) {
      if (p.status !== 'suggested') {
        const res = await a.patch(`/api/connections/${ids[p.id]}`, { status: p.status });
        assert.equal(res.status, 200, res.text);
      }
    }
    const tracked = (await a.get('/api/connections')).json.connections;
    assert.equal(tracked.length, 6, 'suggested hidden by default');
    assert.equal((await a.get('/api/connections?status=all')).json.connections.length, 7);
    assert.equal((await a.get('/api/connections?status=contacted')).json.connections.length, 2);
    assert.equal((await a.get(`/api/connections?branch=${encodeURIComponent(seeded.branch)}`)).json.connections.length, 6);
    assert.equal((await a.get('/api/connections?branch=nope')).json.connections.length, 0);
    assert.equal((await a.get(`/api/connections?conversation=${seeded.conversationId}`)).json.connections.length, 6);
    const ms = (await a.get('/api/connections?q=microsoft')).json.connections;
    assert.equal(ms.length, 4);
    assert.ok(ms.every((c) => c.organization === 'Microsoft'));
    assert.equal((await a.get('/api/connections?q=dev%20pat')).json.connections.length, 1, 'search covers names');
    const facets = (await a.get('/api/connections?facets=1')).json.facets;
    assert.deepEqual(facets.branches, [seeded.branch]);
    assert.equal(facets.conversations[0].id, seeded.conversationId);
  });

  test('funnel and KPIs match a direct count of the rows in the database', async () => {
    const s = (await a.get('/api/insights/summary')).json;

    const { data: rows, error } = await a.db().from('connections').select('status');
    assert.equal(error, null);
    const count = (statuses) => rows.filter((r) => statuses.includes(r.status)).length;
    const stages = ['saved', 'contacted', 'replied', 'meeting_set', 'met'];
    stages.forEach((stage, i) => {
      const f = s.funnel[i];
      assert.equal(f.stage, stage);
      assert.equal(f.reached, count(stages.slice(i)), `${stage} reached`);
      assert.equal(f.current, count([stage]), `${stage} current`);
    });
    // The seeded mix: 6 tracked, 5 reached out, 3 replied or further, 2 meetings, 1 met.
    assert.deepEqual(s.funnel.map((f) => f.reached), [6, 5, 3, 2, 1]);
    assert.equal(s.kpis.connections_saved, 6);
    assert.equal(s.kpis.reached_out, 5);
    assert.equal(s.kpis.replied, 3);
    assert.equal(s.kpis.reply_rate, 3 / 5);
    assert.equal(s.kpis.met, 1);
    assert.equal(s.kpis.maps_created, 1);
    assert.equal(s.funnel[1].conversion, 5 / 6);

    const orgs = Object.fromEntries(s.mix.organizations.map((o) => [o.label, o.count]));
    assert.deepEqual(orgs, { Microsoft: 4, Google: 1, Amazon: 1 });

    const thisWeek = s.activity.weeks.at(-1);
    assert.equal(thisWeek.maps, 1);
    assert.equal(thisWeek.outreach, 6); // one status change per tracked connection
  });

  test('follow-ups due include past follow-up dates', async () => {
    const s = (await a.get('/api/insights/summary?today=2026-01-10')).json;
    const due = s.followups.find((f) => f.id === ids[PEOPLE[1].id]);
    assert.ok(due);
    assert.equal(due.reason, 'follow_up');
    assert.equal(due.days, 5);
  });

  test('tips: starter tips under 3 saved; demo tips cached while the summary is unchanged', async () => {
    const starter = await b.post('/api/insights/tips');
    assert.equal(starter.status, 200, starter.text);
    assert.equal(starter.json.source, 'starter');
    assert.equal(starter.json.tips.length, 3);

    const first = await a.post('/api/insights/tips');
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.source, 'demo');
    assert.equal(first.json.cached, false);
    assert.ok(first.json.tips.length >= 3 && first.json.tips.length <= 6);
    for (const t of first.json.tips) {
      assert.ok(t.title && t.body && t.based_on);
      assert.ok(['open_connection', 'practice', 'new_map', 'none'].includes(t.action.type));
    }
    assert.ok(first.json.tips.some((t) => /4 of your 6 saved connections are at Microsoft/.test(t.based_on)));

    const second = await a.post('/api/insights/tips');
    assert.equal(second.json.cached, true);
    assert.deepEqual(second.json.tips, first.json.tips);

    // A change to the network changes the summary, so the tips are rebuilt.
    await a.patch(`/api/connections/${ids[PEOPLE[0].id]}`, { status: 'contacted' });
    const third = await a.post('/api/insights/tips');
    assert.equal(third.json.cached, false);
  });

  test('the person panel on the map reads and writes the same connection', async () => {
    const convo = await a.get(`/api/conversations/${seeded.conversationId}`);
    const tracked = convo.json.connections[PEOPLE[3].id];
    assert.equal(tracked.status, 'replied');
    const res = await a.patch(`/api/conversations/${seeded.conversationId}/connections`, { personKey: PEOPLE[3].id, notes: 'Coffee next week' });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.id, tracked.id);
    assert.equal(res.json.notes, 'Coffee next week');
  });
});
