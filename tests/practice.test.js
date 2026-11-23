// Practice coffee chat API tests. Same setup as the other suites: a demo-mode server (no OpenAI
// key, so persona replies and feedback are the deterministic demo ones) against the Supabase
// project in .env, with throwaway users deleted at the end.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { configured, makeEmail, signUp as signUpAs, deleteAccounts, startServer } from './helpers.js';
import { validateReport, cleanReport, mockReport, isVerbatim, RUBRIC, MOCK_LINES, scoreOutOf10, savedReport, summarize } from '../lib/practice.js';

let server;
const created = [];
const email = makeEmail('prac');
const signUp = (who) => signUpAs(email(who), created, `Test ${who}`);

// Parse a Server-Sent Events body into [{ event, data }].
const sse = (text) =>
  text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      return { event, data: data ? JSON.parse(data) : null };
    });

// A saved map with two people, so the user has connections to practice with.
async function seedConnection(client) {
  const turn = await client.post('/api/network', { message: 'PM internship at Microsoft' });
  assert.equal(turn.status, 200, turn.text);
  const id = turn.json.conversationId;
  const map = (await client.get(`/api/conversations/${id}`)).json.map;
  map.branches[0].people = [
    { id: 'https://example.com/in/ana', name: 'Ana Ortiz', headline: 'Product Manager at Microsoft', url: 'https://example.com/in/ana', why: 'Ana Ortiz studied at UW.', talking_points: ['Ask how she moved into PM'] },
  ];
  assert.equal((await client.put(`/api/conversations/${id}/map`, { map })).status, 200);
  const all = await client.get('/api/connections?status=all');
  return all.json.connections[0].id;
}

const start = (client, connectionId, extra = {}) =>
  client.post('/api/practice', { connection_id: connectionId, goal: 'learn_role', mood: 'friendly', length: 'short', ...extra });

const USER_LINES = [
  "Hi! I'm a UW Informatics freshman and I really liked your path into product.",
  'How did you decide to move from engineering into product management?',
  'You mentioned talking to customers. How do you decide which feedback matters most?',
  'What would you look for in an intern on your team?',
  'That makes sense. What skill should I build this summer?',
  'How did you find your first PM role?',
  'Would you be open to me sending a short update after my project?',
  'Thank you so much for your time today.',
];

describe('Practice API', { skip: configured ? false : 'SUPABASE_URL / SUPABASE_ANON_KEY not set in .env' }, () => {
  let a;
  let b;
  let connectionId;
  let sessionId; // short session that runs to its turn limit

  before(async () => {
    ({ child: server } = await startServer());
    ({ client: a } = await signUp('a'));
    ({ client: b } = await signUp('b'));
    connectionId = await seedConnection(a);
  });

  after(async () => {
    await deleteAccounts(created);
    server?.kill();
  });

  test('creating a session and posting a message stores both messages', async () => {
    const created = await start(a, connectionId);
    assert.equal(created.status, 201, created.text);
    const { id, opening, persona, max_turns, demo } = created.json;
    assert.ok(opening && persona.first_name);
    assert.notEqual(persona.first_name, 'Ana', 'the persona never takes the real name');
    assert.equal(max_turns, 8);
    assert.equal(demo, true);

    const msg = await a.post(`/api/practice/${id}/message`, { content: USER_LINES[0] });
    assert.equal(msg.status, 200, msg.text);
    assert.match(msg.headers.get('content-type'), /text\/event-stream/);
    const events = sse(msg.text);
    const deltas = events.filter((e) => e.event === 'delta');
    assert.ok(deltas.length > 1, 'the reply streams in more than one piece');
    const done = events.find((e) => e.event === 'done');
    assert.deepEqual({ turn: done.data.turn, turns_left: done.data.turns_left, limit_reached: done.data.limit_reached }, { turn: 1, turns_left: 7, limit_reached: false });
    const streamed = deltas.map((e) => e.data.text).join('').trim();
    assert.equal(streamed, MOCK_LINES[0]);

    const got = await a.get(`/api/practice/${id}`);
    assert.equal(got.status, 200, got.text);
    assert.deepEqual(got.json.messages.map((m) => [m.role, m.content]), [
      ['assistant', opening],
      ['user', USER_LINES[0]],
      ['assistant', MOCK_LINES[0]],
    ]);
    assert.equal(got.json.turns_used, 1);

    // Directly in the database, too.
    const { data } = await a.db().from('practice_messages').select('role').eq('practice_session_id', id);
    assert.equal(data.length, 3);
  });

  test('messages over 1,000 characters are rejected', async () => {
    const list = await a.get('/api/practice');
    const id = list.json.sessions[0].id;
    const res = await a.post(`/api/practice/${id}/message`, { content: 'x'.repeat(1001) });
    assert.equal(res.status, 400);
  });

  test('the turn limit returns 409', async () => {
    const created = await start(a, connectionId, { goal: 'Find out what the team is like', mood: 'busy' });
    assert.equal(created.status, 201, created.text);
    sessionId = created.json.id;
    let last;
    for (const line of USER_LINES) {
      const res = await a.post(`/api/practice/${sessionId}/message`, { content: line });
      assert.equal(res.status, 200, res.text);
      last = sse(res.text).find((e) => e.event === 'done').data;
    }
    assert.equal(last.limit_reached, true);
    assert.equal(last.turns_left, 0);
    const over = await a.post(`/api/practice/${sessionId}/message`, { content: 'One more question?' });
    assert.equal(over.status, 409);
  });

  test('end is idempotent and logs practice_completed once', async () => {
    const first = await a.post(`/api/practice/${sessionId}/end`);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.status, 'completed');
    assert.ok(first.json.report);
    assert.equal(first.json.score, first.json.report.overall_score);

    const second = await a.post(`/api/practice/${sessionId}/end`);
    assert.equal(second.status, 200, second.text);
    assert.deepEqual(second.json, first.json);

    const { data } = await a.db().from('events').select('id').eq('type', 'practice_completed').eq('ref_id', sessionId);
    assert.equal(data.length, 1);

    // An ended chat takes no more messages or hints.
    assert.equal((await a.post(`/api/practice/${sessionId}/message`, { content: 'Hello?' })).status, 409);
    assert.equal((await a.post(`/api/practice/${sessionId}/hint`)).status, 409);
  });

  test('the demo-mode feedback validates against the report schema, with verbatim evidence', async () => {
    const got = await a.get(`/api/practice/${sessionId}`);
    const report = got.json.report;
    assert.deepEqual(validateReport(report), []);
    const userMessages = got.json.messages.filter((m) => m.role === 'user').map((m) => m.content);
    for (const [k] of RUBRIC) {
      const q = report.rubric[k].evidence;
      if (q !== null) assert.ok(isVerbatim(q, userMessages), `${k} evidence "${q}" is not in the user's messages`);
    }
    if (report.rewrite) assert.ok(isVerbatim(report.rewrite.original, userMessages));
  });

  test('history lists sessions with connection, score and goal', async () => {
    const list = await a.get('/api/practice');
    assert.equal(list.status, 200, list.text);
    const s = list.json.sessions.find((x) => x.id === sessionId);
    assert.equal(s.status, 'completed');
    assert.equal(s.connection.name, 'Ana Ortiz');
    assert.equal(s.goal, 'Find out what the team is like');
    assert.equal(typeof s.score, 'number');
  });

  test('a hint is private: it is not added to the transcript', async () => {
    const created = await start(a, connectionId, { length: 'standard' });
    const id = created.json.id;
    const hint = await a.post(`/api/practice/${id}/hint`);
    assert.equal(hint.status, 200, hint.text);
    assert.ok(hint.json.hint.length > 5);
    const got = await a.get(`/api/practice/${id}`);
    assert.equal(got.json.messages.length, 1); // just the opening line
    // Ending with no user messages closes it without a report.
    const end = await a.post(`/api/practice/${id}/end`);
    assert.equal(end.json.status, 'abandoned');
    assert.equal(end.json.report, null);
  });

  test("user B gets 404 on user A's session", async () => {
    assert.equal((await b.get(`/api/practice/${sessionId}`)).status, 404);
    assert.equal((await b.post(`/api/practice/${sessionId}/message`, { content: 'Hi' })).status, 404);
    assert.equal((await b.post(`/api/practice/${sessionId}/hint`)).status, 404);
    assert.equal((await b.post(`/api/practice/${sessionId}/end`)).status, 404);
    assert.equal((await start(b, connectionId)).status, 404, "B can't practice with A's connection");
    assert.deepEqual((await b.get('/api/practice')).json.sessions, []);
  });

  // (As user B: practice POSTs share the 20-per-10-minutes LLM limit, and A has used most of it.)
  test('bad setup values are rejected', async () => {
    assert.equal((await start(b, connectionId, { mood: 'angry' })).status, 400);
    assert.equal((await start(b, connectionId, { length: 'forever' })).status, 400);
    assert.equal((await start(b, 'not-an-id')).status, 400);
  });
});

describe('Practice report checks (no server)', () => {
  const scenario = { persona: { first_name: 'Maya', title: 'Product Manager', organization: 'Microsoft' } };
  const user = ['Hi, I am studying Informatics at UW.', 'How did you get into product?', 'Thanks for your time!'];

  test('the demo report validates and quotes the user verbatim', () => {
    const r = mockReport(scenario, user);
    assert.deepEqual(validateReport(r), []);
    for (const [k] of RUBRIC) if (r.rubric[k].evidence !== null) assert.ok(isVerbatim(r.rubric[k].evidence, user));
  });

  test('quotes that are not verbatim are dropped, scores are clamped', () => {
    const raw = mockReport(scenario, user);
    raw.rubric.opening.evidence = 'I study informatics at the University of Washington'; // paraphrase
    raw.rubric.curiosity.evidence = '“How did you get into product?”'; // verbatim inside curly quotes
    raw.rewrite = { original: 'how did u get into product', stronger: 'x', why: 'y' };
    raw.overall_score = 14;
    raw.rubric.ask.score = 0;
    const c = cleanReport(raw, user);
    assert.equal(c.rubric.opening.evidence, null);
    assert.equal(c.rubric.curiosity.evidence, 'How did you get into product?');
    assert.equal(c.rewrite, null);
    assert.equal(c.overall_score, 10);
    assert.equal(c.rubric.ask.score, 1);
    assert.deepEqual(validateReport(c), []);
  });

  test('the validator rejects extra fields and wrong counts', () => {
    const r = mockReport(scenario, user);
    assert.ok(validateReport({ ...r, extra: true }).length);
    assert.ok(validateReport({ ...r, strengths: ['only one'] }).length);
    assert.ok(validateReport({ ...r, rubric: { ...r.rubric, opening: { score: 3, note: 'no evidence key' } } }).length);
  });

  test('chats scored out of 100 by the earlier voice coffee chat show on the 10-point scale, without their old report', () => {
    assert.deepEqual([62, 31, 7, 9.5, 0, 105].map(scoreOutOf10), [6.2, 3.1, 7, 9.5, 0, 10]);
    assert.equal(scoreOutOf10(null), null);
    assert.equal(summarize({ id: 'x', status: 'completed', score: 31 }).score, 3.1);
    const r = mockReport(scenario, user);
    assert.equal(savedReport(r), r);
    assert.equal(savedReport({ overall: { score: 31, grade: 'C' }, metrics: [], summary: 'old' }), null);
    assert.equal(savedReport(null), null);
  });
});
