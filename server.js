import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockPlan, mockPeople } from './mock.js';
import { exaPeopleSearch, enrichPeople, UpstreamError } from './people.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const apiKey = process.env.OPENAI_API_KEY?.trim();
const exaKey = process.env.EXA_API_KEY?.trim();

// No key (or the placeholder from .env) -> run with demo data so the UI still works.
const hasRealKey = Boolean(apiKey) && !apiKey.startsWith('sk-your');
const openai = hasRealKey ? new OpenAI({ apiKey }) : null;
const hasExa = Boolean(exaKey) && !exaKey.startsWith('your-');

const app = express();
app.use(express.json({ limit: '1mb' }));
const publicDir = path.join(__dirname, 'public');
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'landing.html')));
app.get('/app', (_req, res) => res.sendFile(path.join(publicDir, 'app.html')));
app.use(express.static(publicDir, { index: false }));

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

app.post('/api/plan', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const map = req.body?.map ?? null;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUser?.content?.trim()) {
    return res.status(400).json({ error: 'Send at least one message.' });
  }

  if (!openai) {
    // Small delay so the loading state is visible in demo mode.
    await new Promise((r) => setTimeout(r, 700));
    return res.json({ ...mockPlan(lastUser.content, map), mock: true });
  }

  try {
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
    if (message?.refusal) {
      return res.status(422).json({ error: message.refusal });
    }
    return res.json(JSON.parse(message.content));
  } catch (err) {
    return sendError(res, err);
  }
});

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

// ---------------------------------------------------------------------------
// People for one branch: Exa finds real profiles, the model writes the details.
// ---------------------------------------------------------------------------
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
  if (err instanceof UpstreamError) {
    return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
  }
  console.error('[openai]', err?.status ?? '', err?.message ?? err);
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const hint =
    status === 401
      ? 'OpenAI rejected the API key. Check OPENAI_API_KEY in your .env file.'
      : status === 404
        ? `The model "${MODEL}" isn't available on your account. Change OPENAI_MODEL in .env.`
        : status === 429
          ? 'Rate limited or out of credits on your OpenAI account.'
          : 'Something went wrong talking to OpenAI. Check the server terminal for details.';
  return res.status(status).json({ error: hint });
}

app.listen(PORT, () => {
  console.log(`\n  Network prototype running at http://localhost:${PORT} (app at /app)`);
  if (!openai) {
    console.log('  No OpenAI key found: running with demo data. Add your key to .env and restart.\n');
  } else {
    console.log(`  Using OpenAI model: ${MODEL}`);
    console.log(hasExa ? '  People search: Exa\n' : '  People search is OFF: add EXA_API_KEY to .env to find real people.\n');
  }
});
