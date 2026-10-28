import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockNetwork } from './mock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const apiKey = process.env.OPENAI_API_KEY?.trim();

// No key (or the placeholder from .env) -> run with demo data so the UI still works.
const hasRealKey = Boolean(apiKey) && !apiKey.startsWith('sk-your');
const openai = hasRealKey ? new OpenAI({ apiKey }) : null;

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// The shape the model must return. Strict JSON schema = no parsing surprises.
// ---------------------------------------------------------------------------
const connectionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'organization', 'why', 'talking_points', 'search_query'],
  properties: {
    title: { type: 'string', description: 'Specific profile of the person to reach, e.g. "Product Manager, Azure (UW Informatics alum)"' },
    organization: { type: 'string', description: 'Company, school, lab, or community they belong to' },
    why: { type: 'string', description: 'One sentence on why this person is worth meeting for the user' },
    talking_points: {
      type: 'array',
      description: '2-4 concrete conversation openers tailored to the user and this person',
      items: { type: 'string' },
    },
    search_query: { type: 'string', description: 'A short people-search query to find this person on LinkedIn' },
  },
};

const networkSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'goal', 'branches'],
  properties: {
    reply: { type: 'string', description: '1-3 sentence conversational reply to the user' },
    goal: { type: 'string', description: 'The user goal in under 8 words; this is the root of the map' },
    branches: {
      type: 'array',
      description: '3-5 categories of people to network with',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'why', 'connections'],
        properties: {
          label: { type: 'string', description: 'Short category name, e.g. "Alumni at target companies"' },
          why: { type: 'string', description: 'Why this category matters for the goal' },
          connections: { type: 'array', items: connectionSchema },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a networking research assistant inside a networking app.
The user describes who they are and what they want. You map out the people they should network with.

Rules:
- Return 3-5 branches (categories of people), each with 2-4 connections.
- Each connection is a specific, findable PROFILE (role + organization + shared tie), not an invented name.
  Never make up names of private individuals. Only name a real public figure if you are confident they exist and the fit is real.
- Prefer people with a shared tie to the user (same school, hometown, past employer, club, background), because those replies come back most often.
- Talking points must be specific to both the user and the person, never generic ("tell me about your journey").
- search_query should be something the user can paste into LinkedIn people search.
- On follow-up messages, return the FULL updated map, applying what the user asked to change.
- If key details are missing (school, field, location), still produce a map, and ask for the one detail that would improve it most in your reply.`;

app.get('/api/status', (_req, res) => {
  res.json({ mock: !openai, model: MODEL });
});

app.post('/api/network', async (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');

  if (!lastUser?.content?.trim()) {
    return res.status(400).json({ error: 'Send at least one message.' });
  }

  if (!openai) {
    // Small delay so the loading state is visible in demo mode.
    await new Promise((r) => setTimeout(r, 700));
    return res.json({ ...mockNetwork(lastUser.content), mock: true });
  }

  try {
    const history = messages.slice(-12).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').slice(0, 8000),
    }));

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'network_map', strict: true, schema: networkSchema },
      },
    });

    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      return res.status(422).json({ error: message.refusal });
    }

    return res.json(JSON.parse(message.content));
  } catch (err) {
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
});

app.listen(PORT, () => {
  console.log(`\n  Network prototype running at http://localhost:${PORT}`);
  console.log(
    openai
      ? `  Using OpenAI model: ${MODEL}\n`
      : '  No OpenAI key found: running with demo data. Add your key to .env and restart.\n',
  );
});
