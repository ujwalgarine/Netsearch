import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import OpenAI from 'openai';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockPlan, mockPeople } from './mock.js';
import { exaPeopleSearch, enrichPeople, UpstreamError } from './people.js';
import { createAuth, sameOriginOnly } from './lib/auth.js';
import * as store from './lib/store.js';
import * as insights from './lib/insights.js';
import * as practice from './lib/practice.js';
import { loadOptout } from './lib/enrich.js';
import { workRoutes } from './lib/work.js';
import rateLimit from 'express-rate-limit';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT ?? 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const apiKey = process.env.OPENAI_API_KEY?.trim();
const exaKey = process.env.EXA_API_KEY?.trim();
const production = process.env.NODE_ENV === 'production';

// No key (or the placeholder from .env) -> run with demo data so the UI still works.
const hasRealKey = Boolean(apiKey) && !apiKey.startsWith('sk-your');
const openai = hasRealKey ? new OpenAI({ apiKey }) : null;
const hasExa = Boolean(exaKey) && !exaKey.startsWith('your-');

// Accounts (Supabase). Only the publishable/anon key is used; row level security in
// supabase/schema.sql protects the data. It is used on this server only.
const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey = process.env.SUPABASE_ANON_KEY?.trim();
const hasAccounts = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project'));

const auth = hasAccounts ? createAuth({ supabaseUrl, supabaseKey, production }) : accountsOff();

const app = express();
app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
        // 'unsafe-inline' covers the landing page's style="--i: 0" attributes; no inline scripts are allowed.
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'https://unpkg.com'],
        'img-src': ["'self'", 'data:', 'https:'], // profile photos come from many hosts
        'connect-src': ["'self'", 'https://assets.uberdesigner.ai'], // the landing hero fetches its log images for byte progress
        'upgrade-insecure-requests': production ? [] : null,
      },
    },
    strictTransportSecurity: production,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Sites allowed to send writes besides this host: APP_ORIGIN (comma-separated) and, in a
// GitHub Codespace, this port's forwarded https://<codespace>-<port>.app.github.dev address.
const trustedOrigins = (process.env.APP_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
  trustedOrigins.push(`https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
}
app.use(sameOriginOnly(trustedOrigins));

const publicDir = path.join(__dirname, 'public');
const page = (file) => (_req, res) => res.sendFile(path.join(publicDir, file));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Pages are only served through their guarded routes, never as raw .html files.
app.get(['/landing.html', '/app.html', '/login.html', '/signup.html'], (req, res) =>
  res.redirect(req.path === '/landing.html' ? '/' : req.path.replace(/\.html$/, '')),
);
app.use(['/api', '/app', '/login', '/signup'], auth.attach);

app.get('/', page('landing.html'));
app.get('/login', auth.redirectIfSignedIn, page('login.html'));
app.get('/signup', auth.redirectIfSignedIn, page('signup.html'));
app.get(['/app', '/app/*'], auth.requirePageUser, page('app.html'));
app.use(express.static(publicDir, { index: false }));

app.use('/api/auth', auth.router);
app.use('/api', auth.requireApiUser); // everything below needs a signed-in user

// ---------------------------------------------------------------------------
// Planning: the model decides the branches (categories of people) and how to
// search for each. People are filled in separately, one branch at a time.
// ---------------------------------------------------------------------------
const planSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'goal', 'profile', 'branches'],
  properties: {
    reply: { type: 'string', description: '1-3 sentence conversational reply to the user' },
    goal: { type: 'string', description: 'The user goal in under 8 words; this is the root of the map' },
    profile: {
      type: 'string',
      description: 'Everything known about the user (school, major, year, location, employers, interests) in 1-3 sentences, used to personalize talking points',
    },
    branches: {
      type: 'array',
      description: 'The full list of branches after this turn, in display order',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'why', 'query', 'refresh'],
        properties: {
          id: { type: 'string', description: 'id of an existing branch to keep, or "" for a new branch' },
          label: { type: 'string', description: 'Short category name, e.g. "UW alumni at Microsoft"' },
          why: { type: 'string', description: 'Why this category matters for the goal' },
          query: {
            type: 'string',
            description: 'Natural-language people search, e.g. "professional profiles of product managers at Microsoft who studied at the University of Washington"',
          },
          refresh: { type: 'boolean', description: 'true to search for new people (new branch, or the user asked to change who is in it)' },
        },
      },
    },
  },
};

const PLAN_PROMPT = `You are a networking research assistant inside a networking app.
The user describes who they are and what they want. You decide which groups of people they should network with.
A people search engine then finds real people for each group, so you never name people yourself.

Rules:
- On the first turn, return 3-5 branches.
- Each query describes real, findable people: role + organization or industry + location + a shared tie with the user when one is known.
  Start queries with "professional profiles of". Keep them specific enough that a search returns the right people.
- Prefer shared ties (same school, hometown, past employer, club, background): those replies come back most often.
- The user can edit the map by hand. When a current map is provided, it is the source of truth:
  keep every existing branch (same id, refresh=false) unless the user asks to change or remove it.
  Set refresh=true only for branches whose people should be searched again. New branches use id "".
- If key details are missing (school, field, location), still produce a map, and ask for the one detail that would improve it most in your reply.`;


app.get('/api/status', (_req, res) => {
  res.json({ mock: !openai, people: Boolean(openai && hasExa), model: MODEL });
});

app.delete('/api/account', wrap((req, res) => auth.deleteAccount(req, res)));

// ---------------------------------------------------------------------------
// Saved chats
// ---------------------------------------------------------------------------

app.get('/api/conversations', wrap(async (req, res) => {
  res.json({ conversations: await store.listConversations(req.auth.db, req.auth.user.id) });
}));

app.get('/api/conversations/:id', wrap(async (req, res) => {
  const convo = await store.loadConversation(req.auth.db, req.auth.user.id, req.params.id);
  if (!convo) return notFound(res);
  res.json(convo);
}));

app.patch('/api/conversations/:id', wrap(async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Give the chat a name.' });
  const convo = await store.renameConversation(req.auth.db, req.auth.user.id, req.params.id, title);
  if (!convo) return notFound(res);
  res.json(convo);
}));

app.delete('/api/conversations/:id', wrap(async (req, res) => {
  const deleted = await store.deleteConversation(req.auth.db, req.auth.user.id, req.params.id);
  if (!deleted) return notFound(res);
  res.json({ ok: true });
}));

// The map after manual edits or finished people searches (updates the latest version).
app.put('/api/conversations/:id/map', wrap(async (req, res) => {
  const { db, user } = req.auth;
  const map = req.body?.map;
  if (!map || typeof map !== 'object' || !Array.isArray(map.branches)) {
    return res.status(400).json({ error: 'Send the map to save.' });
  }
  if (!(await store.getConversation(db, user.id, req.params.id))) return notFound(res);
  const version = await store.saveLatestMap(db, user.id, req.params.id, map);
  await store.touchConversation(db, user.id, req.params.id);
  res.json({ ok: true, version });
}));

// Track a person from the map (by their id on the map): status, notes, follow-up date.
app.patch('/api/conversations/:id/connections', wrap(async (req, res) => {
  const { fields, error } = store.connectionPatch(req.body);
  if (error) return res.status(400).json({ error });
  const row = await store.updatePersonConnection(req.auth.db, req.auth.user.id, req.params.id, req.body?.personKey, fields);
  if (!row) return notFound(res);
  res.json({ ...row, personKey: row.person_key });
}));

// ---------------------------------------------------------------------------
// Connections (outreach tracking)
// ---------------------------------------------------------------------------

app.get('/api/connections', wrap(async (req, res) => {
  const { db, user } = req.auth;
  const filters = {
    status: String(req.query.status ?? 'tracked'),
    branch: String(req.query.branch ?? ''),
    conversation: String(req.query.conversation ?? ''),
    q: String(req.query.q ?? ''),
  };
  const [connections, facets] = await Promise.all([
    store.listConnections(db, user.id, filters),
    req.query.facets === '1' ? store.connectionFacets(db, user.id) : null,
  ]);
  res.json({ connections, ...(facets ? { facets } : {}) });
}));

app.patch('/api/connections/:id', wrap(async (req, res) => {
  const { fields, error } = store.connectionPatch(req.body);
  if (error) return res.status(400).json({ error });
  const row = await store.updateConnection(req.auth.db, req.auth.user.id, req.params.id, fields);
  if (!row) return notFound(res);
  res.json(row);
}));

// ---------------------------------------------------------------------------
// Insights: analytics from the user's own rows, and tips from a summary of their network
// ---------------------------------------------------------------------------

app.get('/api/insights/summary', wrap(async (req, res) => {
  res.json(await insights.insightsSummary(req.auth.db, req.auth.user.id, { today: req.query.today }));
}));

// LLM endpoints: 20 requests per 10 minutes per user.
const llmLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.auth.user.id,
  handler: (req, res) =>
    res.status(429).json({
      error: req.originalUrl.startsWith('/api/practice')
        ? 'Too many practice requests. Try again in a few minutes.'
        : 'Too many tip refreshes. Try again in a few minutes.',
    }),
});

app.post('/api/insights/tips', llmLimiter, wrap(async (req, res) => {
  try {
    res.json(await insights.getTips(req.auth.db, req.auth.user.id, { openai, model: MODEL }));
  } catch (err) {
    if (err instanceof store.StoreError) throw err;
    return sendError(res, err);
  }
}));

// ---------------------------------------------------------------------------
// Practice coffee chats (lib/practice.js). Every route is per user; the ones that call the model
// share the per-user LLM limit above.
// ---------------------------------------------------------------------------

app.get('/api/practice', wrap(async (req, res) => {
  res.json({ sessions: await practice.listSessions(req.auth.db, req.auth.user.id) });
}));

app.get('/api/practice/:id', wrap(async (req, res) => {
  const { db, user } = req.auth;
  const s = await practice.getSession(db, user.id, req.params.id);
  if (!s) return notFound(res);
  const messages = await practice.getMessages(db, user.id, s.id);
  res.json({
    ...practice.summarize(s),
    goal_key: s.scenario_json?.goal ?? '',
    talking_points: s.scenario_json?.talking_points ?? [],
    turns_used: messages.filter((m) => m.role === 'user').length,
    messages,
    report: practice.savedReport(s.feedback_json),
    earlier_version: Boolean(s.feedback_json) && !practice.savedReport(s.feedback_json),
  });
}));

app.post('/api/practice', llmLimiter, wrap(async (req, res) => {
  const { db, user } = req.auth;
  const { setup, error } = practice.parseSetup(req.body);
  if (error) return res.status(400).json({ error });
  const conn = await practice.getConnection(db, user.id, setup.connection_id);
  if (!conn) return notFound(res);
  const context = await practice.mapContext(db, user.id, conn.conversation_id, conn.person_key);
  const scenario = practice.buildScenario(setup, conn, context, { mock: !openai });

  let opening;
  try {
    opening = await practice.openingLine({ openai, model: MODEL, scenario });
  } catch (err) {
    return sendError(res, err);
  }
  const s = await practice.createSession(db, user.id, conn.id, scenario, opening);
  res.status(201).json({ id: s.id, opening, persona: scenario.persona, max_turns: scenario.max_turns, demo: scenario.mock });
}));

// One user turn. The persona's reply streams back as Server-Sent Events:
//   start {turn, max_turns} · delta {text} … · done {turn, max_turns, turns_left, limit_reached, demo} · error {error}
// Both messages are saved once the reply is complete.
app.post('/api/practice/:id/message', llmLimiter, wrap(async (req, res) => {
  const { db, user } = req.auth;
  const content = String(req.body?.content ?? '').trim();
  if (!content) return res.status(400).json({ error: 'Write a message first.' });
  if (content.length > practice.MAX_MESSAGE) return res.status(400).json({ error: `Keep messages under ${practice.MAX_MESSAGE.toLocaleString('en-US')} characters.` });
  const s = await practice.getSession(db, user.id, req.params.id);
  if (!s) return notFound(res);
  if (s.status !== 'active') return res.status(409).json({ error: 'This practice chat has ended.' });
  const history = await practice.getMessages(db, user.id, s.id);
  const used = history.filter((m) => m.role === 'user').length;
  const max = s.scenario_json.max_turns;
  if (used >= max) return res.status(409).json({ error: 'Turn limit reached. End the chat to see your feedback.' });

  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('start', { turn: used + 1, max_turns: max });

  let reply = '';
  try {
    for await (const piece of practice.replyStream({ openai, model: MODEL, scenario: s.scenario_json, history, content })) {
      reply += piece;
      send('delta', { text: piece });
    }
    reply = reply.trim();
    if (!reply) throw new Error('empty reply');
    await practice.addMessages(db, user.id, s.id, [{ role: 'user', content }, { role: 'assistant', content: reply }]);
  } catch (err) {
    send('error', { error: err instanceof store.StoreError ? `${err.message} Try again.` : errorHint(err).error });
    return res.end();
  }
  send('done', { turn: used + 1, max_turns: max, turns_left: max - used - 1, limit_reached: used + 1 >= max, demo: Boolean(s.scenario_json.mock) });
  res.end();
}));

// A private coaching hint: one suggested next question. Never added to the transcript.
app.post('/api/practice/:id/hint', llmLimiter, wrap(async (req, res) => {
  const { db, user } = req.auth;
  const s = await practice.getSession(db, user.id, req.params.id);
  if (!s) return notFound(res);
  if (s.status !== 'active') return res.status(409).json({ error: 'This practice chat has ended.' });
  const history = await practice.getMessages(db, user.id, s.id);
  try {
    res.json({ hint: await practice.coachHint({ openai, model: MODEL, scenario: s.scenario_json, history }), demo: Boolean(s.scenario_json.mock) });
  } catch (err) {
    return sendError(res, err);
  }
}));

// Ends the chat and returns the feedback report. Idempotent: later calls return the stored report.
// With no user messages there's nothing to score: the session is closed as "abandoned".
app.post('/api/practice/:id/end', llmLimiter, wrap(async (req, res) => {
  const { db, user } = req.auth;
  let s = await practice.getSession(db, user.id, req.params.id);
  if (!s) return notFound(res);
  const reply = (row) => res.json({ id: row.id, status: row.status, score: row.score, report: row.feedback_json ?? null, demo: Boolean(row.scenario_json?.mock) });
  if (s.status !== 'active') return reply(s);

  const history = await practice.getMessages(db, user.id, s.id);
  if (!history.some((m) => m.role === 'user')) {
    return reply((await practice.finishSession(db, user.id, s.id, { status: 'abandoned' })) ?? (await practice.getSession(db, user.id, s.id)));
  }
  let report;
  try {
    report = await practice.generateReport({ openai, model: MODEL, scenario: s.scenario_json, history });
  } catch (err) {
    return sendError(res, err);
  }
  const done = await practice.finishSession(db, user.id, s.id, { status: 'completed', score: report.overall_score, report });
  // Lost a race with another /end: serve the report that was stored first.
  s = done ?? (await practice.getSession(db, user.id, s.id));
  reply(s);
}));

// ---------------------------------------------------------------------------
// Work and projects: one person's own public work, from accounts they linked (lib/work.js)
// ---------------------------------------------------------------------------

app.use('/api', workRoutes({
  openai,
  model: MODEL,
  exaKey: hasExa ? exaKey : null,
  githubToken: process.env.GITHUB_TOKEN?.trim() || null,
  openalexKey: process.env.OPENALEX_API_KEY?.trim() || null,
  stackKey: process.env.STACKEXCHANGE_KEY?.trim() || null,
  optout: loadOptout(path.join(__dirname, 'data', 'optout.json')),
  perDay: Number(process.env.WORK_LOOKUPS_PER_DAY) || 60,
  sendError,
}));

// ---------------------------------------------------------------------------
// One chat turn: plan the map, then save the user message, the reply and the new map version.
// ---------------------------------------------------------------------------

app.post('/api/network', wrap(async (req, res) => {
  const { db, user } = req.auth;
  const message = String(req.body?.message ?? '').trim().slice(0, 8000);
  if (!message) return res.status(400).json({ error: 'Send at least one message.' });

  let conversationId = req.body?.conversationId ?? null;
  let history = [];
  let previous = null;
  if (conversationId) {
    if (!(await store.getConversation(db, user.id, conversationId))) return notFound(res);
    [history, previous] = await Promise.all([
      store.getMessages(db, user.id, conversationId),
      store.getLatestMap(db, user.id, conversationId),
    ]);
  }
  const prevMap = previous?.data_json ?? null;
  const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message }];

  let plan;
  try {
    plan = await planTurn(messages, prevMap);
  } catch (err) {
    return sendError(res, err);
  }

  const map = mergePlan(prevMap, plan);
  if (!conversationId) conversationId = (await store.createConversation(db, user.id, plan.goal)).id;
  await store.addMessages(db, user.id, conversationId, [
    { role: 'user', content: message },
    { role: 'assistant', content: plan.reply },
  ]);
  await store.addMapVersion(db, user.id, conversationId, map);
  await store.touchConversation(db, user.id, conversationId);

  res.json({
    conversationId,
    reply: plan.reply,
    goal: plan.goal,
    profile: plan.profile,
    // Same branch list the planner returned, with ids filled in for new branches.
    branches: plan.branches.map((b, i) => ({ ...b, id: map.branches[i].id })),
    ...(plan.mock ? { mock: true } : {}),
  });
}));

// The planner, unchanged: the model (or demo data) turns the conversation and current map into branches.
async function planTurn(messages, map) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  if (!openai) {
    // Small delay so the loading state is visible in demo mode.
    await new Promise((r) => setTimeout(r, 700));
    return { ...mockPlan(lastUser.content, map), mock: true };
  }

  const history = messages.slice(-12).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? '').slice(0, 8000),
  }));
  const context = map
    ? [{ role: 'system', content: `Current map, including the user's manual edits:\n${JSON.stringify(compactMap(map))}` }]
    : [];

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: PLAN_PROMPT }, ...context, ...history],
    response_format: { type: 'json_schema', json_schema: { name: 'network_plan', strict: true, schema: planSchema } },
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new UpstreamError('openai', 422, message.refusal);
  return JSON.parse(message.content);
}

// Apply a plan to the saved map the same way the browser does: kept branches keep their people,
// new or refreshed branches start empty (the browser then searches for their people).
function mergePlan(prevMap, plan) {
  const prev = new Map((prevMap?.branches ?? []).map((b) => [b.id, b]));
  const branches = plan.branches.map((p) => {
    const old = p.id ? prev.get(p.id) : null;
    if (old && !p.refresh) return { ...old, label: p.label, why: p.why, query: p.query };
    return { id: old?.id ?? `b${crypto.randomUUID().replace(/-/g, '').slice(0, 14)}`, label: p.label, why: p.why, query: p.query, people: [], status: 'done', error: null, token: null };
  });
  return { goal: plan.goal, profile: plan.profile, branches };
}

function compactMap(map) {
  return {
    goal: String(map.goal ?? ''),
    profile: String(map.profile ?? ''),
    branches: (Array.isArray(map.branches) ? map.branches : []).slice(0, 20).map((b) => ({
      id: String(b.id ?? ''),
      label: String(b.label ?? ''),
      why: String(b.why ?? ''),
      query: String(b.query ?? ''),
      people: (Array.isArray(b.people) ? b.people : []).slice(0, 12).map((p) => `${p.name} (${p.headline})`),
    })),
  };
}

app.post('/api/people', async (req, res) => {
  const branch = req.body?.branch ?? {};
  const query = String(branch.query ?? '').trim().slice(0, 500);
  const label = String(branch.label ?? '').trim().slice(0, 200);
  const exclude = new Set((Array.isArray(req.body?.exclude) ? req.body.exclude : []).map(String));
  const count = Math.min(Math.max(Number(req.body?.count) || 4, 1), 8);

  if (!query && !label) {
    return res.status(400).json({ error: 'Describe who to find in this branch.' });
  }

  if (!openai) {
    await new Promise((r) => setTimeout(r, 500));
    return res.json({ people: mockPeople(label, exclude.size, count), mock: true });
  }
  if (!hasExa) {
    return res.status(503).json({
      error: 'People search is off. Add EXA_API_KEY to .env (free at dashboard.exa.ai) and restart the server.',
    });
  }

  try {
    // Ask for extra candidates: some get filtered as duplicates or poor fits.
    const results = await exaPeopleSearch(exaKey, query || label, Math.min(count + 3 + exclude.size, 25));
    const fresh = results.filter((r) => r?.url && /^https?:\/\//.test(r.url) && !exclude.has(r.url)).slice(0, count + 3);
    if (!fresh.length) return res.json({ people: [] });

    const people = await enrichPeople({
      openai,
      model: MODEL,
      goal: String(req.body?.goal ?? '').slice(0, 300),
      profile: String(req.body?.profile ?? '').slice(0, 1500),
      branch: { label, why: String(branch.why ?? '').slice(0, 500) },
      results: fresh,
    });
    return res.json({ people: people.slice(0, count) });
  } catch (err) {
    return sendError(res, err);
  }
});

function sendError(res, err) {
  const { status, error } = errorHint(err);
  return res.status(status).json({ error });
}

// An upstream (OpenAI / Exa) failure as { status, error } with a message the user can act on.
function errorHint(err) {
  if (err instanceof UpstreamError) {
    return { status: err.status >= 400 && err.status < 600 ? err.status : 502, error: err.message };
  }
  console.error('[openai]', err?.status ?? '', err?.message ?? err);
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const error =
    status === 401
      ? 'OpenAI rejected the API key. Check OPENAI_API_KEY in your .env file.'
      : status === 404
        ? `The model "${MODEL}" isn't available on your account. Change OPENAI_MODEL in .env.`
        : status === 429
          ? 'Rate limited or out of credits on your OpenAI account.'
          : 'Something went wrong talking to OpenAI. Check the server terminal for details.';
  return { status, error };
}


const notFound = (res) => res.status(404).json({ error: 'Not found.' });

// Any error a route didn't handle: JSON, never a stack trace.
app.use((err, _req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'That map is too large to save.' });
  console.error('[server]', err?.message ?? err, err?.cause?.message ?? '');
  res.status(500).json({ error: err instanceof store.StoreError ? `${err.message} Try again.` : 'Something went wrong. Try again.' });
});

// Without Supabase settings the pages still load, and every account action explains what's missing.
function accountsOff() {
  const off = (_req, res) =>
    res.status(503).json({ error: 'Accounts are off: add SUPABASE_URL and SUPABASE_ANON_KEY to .env and restart the server.' });
  const router = express.Router();
  router.get('/session', (_req, res) => res.json({ signedIn: false }));
  router.use(off);
  return {
    attach: (req, _res, next) => { req.auth = null; next(); },
    requireApiUser: (_req, res) => res.status(401).json({ error: 'Sign in to continue.' }),
    requirePageUser: (req, res) => res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`),
    redirectIfSignedIn: (_req, _res, next) => next(),
    router,
    deleteAccount: off,
  };
}

const server = app.listen(PORT, () => {
  const port = server.address().port;
  console.log(`\n  Network prototype running at http://localhost:${port} (app at /app)`);
  console.log(hasAccounts ? '  Accounts: ON (Supabase)' : '  Accounts: OFF (add SUPABASE_URL and SUPABASE_ANON_KEY to .env to turn on)');
  if (!openai) {
    console.log('  No OpenAI key found: running with demo data. Add your key to .env and restart.\n');
  } else {
    console.log(`  Using OpenAI model: ${MODEL}`);
    console.log(hasExa ? '  People search: Exa\n' : '  People search is OFF: add EXA_API_KEY to .env to find real people.\n');
  }
});
