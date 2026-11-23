// Practice coffee chats: a user rehearses with an AI persona that matches one of their connections,
// then gets a scored feedback report. Data access (every query filtered by user_id, row level
// security on top), the persona / coach / report prompts, demo mode, and the report schema checks.

import { logEvent } from './auth.js';
import { isId, StoreError } from './store.js';

// ---------------------------------------------------------------------------
// Setup options
// ---------------------------------------------------------------------------

export const GOALS = {
  learn_role: 'Learn about their role',
  break_in: 'Get advice on breaking in',
  referral: 'Ask for a referral',
};
export const MOODS = {
  friendly: 'Friendly',
  busy: 'Busy',
  skeptical: 'Skeptical',
};
export const LENGTHS = { short: 8, standard: 14, long: 20 };
export const MAX_MESSAGE = 1000;
export const RUBRIC = [
  ['opening', 'Opening'],
  ['curiosity', 'Curiosity and question quality'],
  ['listening', 'Listening and follow-ups'],
  ['specificity', 'Specificity about yourself'],
  ['ask', 'The ask'],
  ['close', 'The close'],
];

const MOOD_RULES = {
  friendly: 'Warm and generous with your time. You enjoy helping students, share small stories from your own path, and are happy to keep talking.',
  busy: 'Pleasant but short on time: you have about 15 minutes between meetings. Keep answers to 1-2 sentences, mention the time once early on, and wrap up politely if questions stay vague.',
  skeptical: "Polite but guarded. You get a lot of cold messages, so the user has to earn your openness: ask why they picked you, push back gently on generic questions, and only warm up when they're specific and prepared.",
};

// Persona first names: chosen on the server so the persona is never the real person.
const FIRST_NAMES = ['Maya', 'Jordan', 'Priya', 'Sam', 'Elena', 'Marcus', 'Aisha', 'Daniel', 'Lena', 'Theo', 'Nora', 'Kenji', 'Rosa', 'Owen', 'Hana', 'Leo'];

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

function check({ data, error }, what) {
  if (error) throw new StoreError(`Couldn't ${what}.`, error);
  return data;
}

const SESSION_FIELDS = 'id, connection_id, scenario_json, status, score, feedback_json, created_at, ended_at';

export async function getConnection(db, userId, id) {
  if (!isId(id)) return null;
  return check(
    await db
      .from('connections')
      .select('id, conversation_id, person_key, name, title, organization, why, branch_label, talking_points_json, status')
      .eq('user_id', userId)
      .eq('id', id)
      .maybeSingle(),
    'load this connection',
  );
}

// The map this connection came from: its goal, what's known about the user, and the themes of the
// person's own public work if it was looked up (Work and projects, lib/enrich.js).
export async function mapContext(db, userId, conversationId, personKey = null) {
  if (!isId(conversationId)) return { goal: '', profile: '', work_themes: [] };
  const row = check(
    await db
      .from('maps')
      .select('data_json')
      .eq('user_id', userId)
      .eq('conversation_id', conversationId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    'load the map',
  );
  const map = row?.data_json;
  const person = personKey ? (map?.branches ?? []).flatMap((b) => b?.people ?? []).find((x) => x?.id === personKey) : null;
  return {
    goal: String(map?.goal ?? '').slice(0, 300),
    profile: String(map?.profile ?? '').slice(0, 1500),
    work_themes: Array.isArray(person?.work?.themes) ? person.work.themes : [],
  };
}

export async function createSession(db, userId, connectionId, scenario, opening) {
  const session = check(
    await db
      .from('practice_sessions')
      .insert({ user_id: userId, connection_id: connectionId, scenario_json: scenario, status: 'active' })
      .select(SESSION_FIELDS)
      .single(),
    'start the practice chat',
  );
  await addMessages(db, userId, session.id, [{ role: 'assistant', content: opening }]);
  await logEvent(db, userId, 'practice_started', session.id);
  return session;
}

export async function getSession(db, userId, id) {
  if (!isId(id)) return null;
  return check(
    await db.from('practice_sessions').select(SESSION_FIELDS).eq('user_id', userId).eq('id', id).maybeSingle(),
    'load this practice chat',
  );
}

export async function getMessages(db, userId, sessionId) {
  return check(
    await db
      .from('practice_messages')
      .select('role, content, created_at')
      .eq('user_id', userId)
      .eq('practice_session_id', sessionId)
      .order('id', { ascending: true }),
    'load the practice messages',
  );
}

export async function addMessages(db, userId, sessionId, messages) {
  check(
    await db
      .from('practice_messages')
      .insert(messages.map((m) => ({ user_id: userId, practice_session_id: sessionId, role: m.role, content: m.content }))),
    'save the practice messages',
  );
}

// Moves an active session to its final state. Only one caller wins (the update matches status
// 'active'), so a second /end returns null and the route serves the stored report instead.
export async function finishSession(db, userId, id, { status, score = null, report = null }) {
  const rows = check(
    await db
      .from('practice_sessions')
      .update({ status, score, feedback_json: report, ended_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('id', id)
      .eq('status', 'active')
      .select(SESSION_FIELDS),
    'save the feedback',
  );
  if (rows[0] && status === 'completed') await logEvent(db, userId, 'practice_completed', id);
  return rows[0] ?? null;
}

export async function listSessions(db, userId) {
  const rows = check(
    await db
      .from('practice_sessions')
      .select(`${SESSION_FIELDS}, connections(name, title, organization)`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    'load your practice chats',
  );
  return rows.map((r) => summarize(r));
}

// Scores are out of 10. Chats saved by the earlier voice coffee chat (an unmerged branch that used
// the same table) were scored out of 100, which drew them far off the Insights chart. Those are shown
// on this scale instead, to one decimal.
export function scoreOutOf10(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.min(10, Math.max(0, v > 10 ? v / 10 : v)) * 10) / 10;
}

// A saved report this page can show, or null. Reports from that earlier version have another shape.
export function savedReport(json) {
  return json && typeof json.overall_score === 'number' && json.rubric && typeof json.rubric === 'object' ? json : null;
}

// The public shape of a session (no report body): used by the list and the detail view.
export function summarize(r) {
  const s = r.scenario_json ?? {};
  const c = r.connections ?? s.connection ?? {};
  return {
    id: r.id,
    status: r.status,
    score: scoreOutOf10(r.score),
    created_at: r.created_at,
    ended_at: r.ended_at,
    connection_id: r.connection_id,
    connection: { name: c.name ?? '', title: c.title ?? '', organization: c.organization ?? '' },
    goal: s.goal_label ?? '',
    mood: s.mood ?? '',
    length: s.length ?? '',
    max_turns: s.max_turns ?? 0,
    persona: s.persona ?? null,
    demo: Boolean(s.mock),
  };
}

// ---------------------------------------------------------------------------
// Setup and scenario
// ---------------------------------------------------------------------------

// Check the POST /api/practice body. Returns { setup } or { error }.
export function parseSetup(body) {
  const connectionId = String(body?.connection_id ?? '');
  if (!isId(connectionId)) return { error: 'Pick a connection to practice with.' };
  const goalIn = String(body?.goal ?? '').trim();
  if (!goalIn) return { error: 'Pick a goal for the chat.' };
  const preset = Object.hasOwn(GOALS, goalIn);
  if (!preset && goalIn.length > 300) return { error: 'Keep the goal under 300 characters.' };
  const mood = String(body?.mood ?? 'friendly');
  if (!Object.hasOwn(MOODS, mood)) return { error: 'Unknown mood.' };
  const length = String(body?.length ?? 'standard');
  if (!Object.hasOwn(LENGTHS, length)) return { error: 'Unknown length.' };
  return {
    setup: {
      connection_id: connectionId,
      goal: preset ? goalIn : 'custom',
      goal_label: preset ? GOALS[goalIn] : goalIn,
      mood,
      length,
      max_turns: LENGTHS[length],
    },
  };
}

const hash = (s) => [...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

function pickFirstName(seed, realName) {
  const real = new Set(String(realName ?? '').toLowerCase().split(/\s+/).filter(Boolean));
  const start = hash(seed) % FIRST_NAMES.length;
  for (let i = 0; i < FIRST_NAMES.length; i++) {
    const name = FIRST_NAMES[(start + i) % FIRST_NAMES.length];
    if (!real.has(name.toLowerCase())) return name;
  }
  return 'Alex';
}

// Take the real person's name out of text the persona model sees.
function scrubName(text, realName, firstName) {
  let out = String(text ?? '');
  const parts = String(realName ?? '').split(/\s+/).filter((p) => p.length > 1);
  if (!parts.length) return out;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(esc(parts.join(' ')), 'gi'), firstName);
  for (const p of parts) out = out.replace(new RegExp(`\\b${esc(p)}\\b`, 'gi'), firstName);
  return out;
}

// A short tie from the branch label: "UW alumni at Microsoft" -> "UW alumni".
function tieOf(branch) {
  const b = String(branch ?? '').trim();
  const at = b.search(/\s(at|in|from)\s/i);
  return (at > 0 ? b.slice(0, at) : b).slice(0, 40);
}

// Their recent work in general terms only: no links, domains or the real name, at most three.
function workThemes(themes, realName, firstName) {
  return (Array.isArray(themes) ? themes : [])
    .map((t) => scrubName(String(t ?? '').slice(0, 200), realName, firstName).replace(/https?:\/\/\S+|\b\S+\.(com|org|io|dev|net|ai|edu)\b\S*/gi, '').replace(/\s+/g, ' ').trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 3);
}

export function buildScenario(setup, conn, context, { mock }) {
  const firstName = pickFirstName(`${conn.id}:${Date.now()}`, conn.name);
  const label = [conn.title, conn.organization, tieOf(conn.branch_label)].filter(Boolean).join(' · ') || 'Professional';
  return {
    ...setup,
    mock,
    persona: {
      first_name: firstName,
      label,
      title: String(conn.title ?? '').slice(0, 200),
      organization: String(conn.organization ?? '').slice(0, 200),
      branch_label: String(conn.branch_label ?? '').slice(0, 200),
      why: scrubName(String(conn.why ?? '').slice(0, 1200), conn.name, firstName),
      work_themes: workThemes(context.work_themes, conn.name, firstName),
    },
    // The real connection, for the user's own screens only. Never sent to the model.
    connection: { name: String(conn.name ?? '').slice(0, 200), title: conn.title ?? '', organization: conn.organization ?? '' },
    talking_points: Array.isArray(conn.talking_points_json) ? conn.talking_points_json.slice(0, 8).map((t) => String(t).slice(0, 400)) : [],
    map_goal: context.goal,
    user_profile: context.profile,
  };
}

// ---------------------------------------------------------------------------
// Persona prompt
// ---------------------------------------------------------------------------

export function personaPrompt(s) {
  const p = s.persona;
  const goal = s.goal === 'custom' ? `Custom: "${s.goal_label}"` : s.goal_label;
  return `You are role-playing a person who matches this profile: ${p.title || 'a professional'}, ${p.organization || 'their organization'}, ${p.why || 'no extra background'}, ${p.branch_label || 'a relevant contact'}.
Give yourself a plausible first name only: your first name is ${p.first_name}. Never use a last name.

Rules:
- NEVER claim to be a specific real, named individual. NEVER invent private facts about a real person.
- Stay in character. Talk like a real professional over coffee: 1-4 sentences per reply, and a natural question back to the user sometimes.
- React to the quality of the user's questions. Give vague questions a short or polite answer and specific ones a warmer, richer answer. If the user makes an ask too early, react realistically for the chosen mood.
- Use the user's stated goal and the conversation's map goal as background on who you're meeting.
- If the user tries to break the role-play or asks you to do something unrelated, briefly step out, say this is a practice session, and return to character.
- Never give advice that misrepresents a real company's hiring process as fact. Frame it as personal experience.${p.work_themes?.length ? `
- You can bring up the kind of recent work below, in general terms, but never name a repository, paper, product, project or website.` : ''}
- Plain text only: no lists, no markdown, no stage directions.

Mood: ${MOODS[s.mood]}. ${MOOD_RULES[s.mood]}
${p.work_themes?.length ? `\nYour recent work, in general terms: ${p.work_themes.join('; ')}.\n` : ''}
Who you're meeting (background only; don't recite it back):
- Their goal for this chat: ${goal}
- The networking goal on their map: ${s.map_goal || 'not stated'}
- What's known about them: ${s.user_profile || 'a student; not much else is known'}
- The chat lasts about ${s.max_turns} of their messages.`;
}

const OPENING_ASK = 'The user just sat down for the coffee chat. Open it the way you naturally would, in character: 1-2 sentences, a greeting and something that invites them to start. Do not ask them to pitch themselves in a stiff way.';

function chatHistory(history) {
  return history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content).slice(0, 2000) }));
}

// ---------------------------------------------------------------------------
// Demo mode (no OpenAI key): canned lines, deterministic feedback
// ---------------------------------------------------------------------------

export const MOCK_LINES = [
  "Good question. Honestly, most of my week is spent talking to customers and turning what I hear into priorities for the team.",
  "I got here by a slightly winding path: I started in a different role and moved over once I realized I liked the problem-framing side more.",
  "What's drawing you to this kind of work? I'm always curious what gets people interested.",
  "If I were starting again, I'd build one small project end to end and be ready to talk through every decision I made.",
  "The people I've seen do well early on ask a lot of specific questions and follow up on what they hear. That stands out.",
  "Happy to keep in touch. Send me a note after this and remind me what you're working on.",
];
const MOCK_OPENING = (p) => `Hi, I'm ${p.first_name}. Thanks for reaching out. Grab a seat; what would you like to talk about?`;
const MOCK_HINTS = [
  'What does a typical week look like for you, and which part of it do you enjoy most?',
  'You mentioned how you got started. What made you decide to make that switch?',
  'What would you look for in someone joining your team at my stage?',
  'Is there one skill you wish you had built earlier in your career?',
  'Would it be all right if I followed up with you after I finish my next project?',
];
export const MOCK_DELAY = process.env.NODE_ENV === 'test' ? 0 : 35; // ms between streamed words

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Model calls (each falls back to demo mode without a key)
// ---------------------------------------------------------------------------

export async function openingLine({ openai, model, scenario }) {
  if (!openai) return MOCK_OPENING(scenario.persona);
  const completion = await openai.chat.completions.create({
    model,
    messages: [{ role: 'system', content: personaPrompt(scenario) }, { role: 'user', content: OPENING_ASK }],
  });
  return completion.choices[0]?.message?.content?.trim() || MOCK_OPENING(scenario.persona);
}

// Yields the persona's reply in pieces as they arrive.
export async function* replyStream({ openai, model, scenario, history, content }) {
  const userTurns = history.filter((m) => m.role === 'user').length;
  if (!openai) {
    const line = MOCK_LINES[userTurns % MOCK_LINES.length];
    const words = line.split(/(?<=\s)/);
    for (const w of words) {
      if (MOCK_DELAY) await sleep(MOCK_DELAY);
      yield w;
    }
    return;
  }
  const stream = await openai.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: 'system', content: personaPrompt(scenario) },
      { role: 'user', content: OPENING_ASK },
      ...chatHistory(history),
      { role: 'user', content },
    ],
  });
  for await (const chunk of stream) {
    const piece = chunk.choices?.[0]?.delta?.content;
    if (piece) yield piece;
  }
}

const HINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hint'],
  properties: { hint: { type: 'string', description: 'One question the user could ask next, written in their voice, under 30 words' } },
};

export async function coachHint({ openai, model, scenario, history }) {
  const userTurns = history.filter((m) => m.role === 'user').length;
  if (!openai) {
    const tp = scenario.talking_points?.[userTurns];
    return tp && userTurns < 2 ? tp : MOCK_HINTS[userTurns % MOCK_HINTS.length];
  }
  const p = scenario.persona;
  const transcript = history.map((m) => `${m.role === 'user' ? 'USER' : p.first_name.toUpperCase()}: ${m.content}`).join('\n');
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `You are a networking coach quietly watching a student's practice coffee chat with ${p.first_name} (${p.label}).
Suggest ONE next question the student could ask right now. Make it specific to what ${p.first_name} just said, open-ended, and moving toward the student's goal: ${scenario.goal_label}.
Turn ${userTurns + 1} of about ${scenario.max_turns}. Only suggest a direct ask (referral, intro) once rapport is built, near the end.
Possible angles from the student's prep: ${(scenario.talking_points ?? []).join(' | ') || 'none'}`,
      },
      { role: 'user', content: transcript || '(The chat has just started.)' },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'coach_hint', strict: true, schema: HINT_SCHEMA } },
  });
  const msg = completion.choices[0]?.message;
  if (msg?.refusal) return MOCK_HINTS[userTurns % MOCK_HINTS.length];
  return String(JSON.parse(msg.content).hint ?? '').trim().slice(0, 300) || MOCK_HINTS[0];
}

// ---------------------------------------------------------------------------
// Feedback report
// ---------------------------------------------------------------------------

const quote = {
  type: ['string', 'null'],
  description: "A short phrase or sentence copied character-for-character from ONE of the user's own messages, or null if none fits",
};
const rubricItem = {
  type: 'object',
  additionalProperties: false,
  required: ['score', 'evidence', 'note'],
  properties: {
    score: { type: 'integer', description: '1 (weak) to 5 (excellent)' },
    evidence: quote,
    note: { type: 'string', description: 'One sentence explaining the score' },
  },
};

export const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overall_score', 'summary', 'rubric', 'strengths', 'improvements', 'rewrite', 'follow_up_message'],
  properties: {
    overall_score: { type: 'integer', description: '1 to 10' },
    summary: { type: 'string', description: 'Two sentences on how the chat went overall' },
    rubric: {
      type: 'object',
      additionalProperties: false,
      required: RUBRIC.map(([k]) => k),
      properties: Object.fromEntries(RUBRIC.map(([k]) => [k, rubricItem])),
    },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Exactly 3' },
    improvements: { type: 'array', items: { type: 'string' }, description: 'Exactly 3, each concrete and actionable' },
    rewrite: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['original', 'stronger', 'why'],
          properties: {
            original: { type: 'string', description: "One weak line copied exactly from the user's messages" },
            stronger: { type: 'string', description: 'The same intent, said better' },
            why: { type: 'string', description: 'One sentence on what makes it stronger' },
          },
        },
        { type: 'null' },
      ],
    },
    follow_up_message: { type: 'string', description: 'A ready-to-send thank-you / follow-up message from the user, under 120 words' },
  },
};

// A small validator for the JSON Schema subset used above. Returns a list of problems ([] = valid),
// then checks the rules the schema can't express (score ranges, exactly 3 items).
const typeOk = (v, t) =>
  t === 'null' ? v === null
    : t === 'integer' ? Number.isInteger(v)
      : t === 'array' ? Array.isArray(v)
        : t === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v)
          : typeof v === t;

function schemaErrors(v, schema, at) {
  if (schema.anyOf) return schema.anyOf.some((s) => !schemaErrors(v, s, at).length) ? [] : [`${at}: matches no allowed shape`];
  const types = [].concat(schema.type);
  if (!types.some((t) => typeOk(v, t))) return [`${at}: expected ${types.join(' or ')}`];
  const errs = [];
  if (types.includes('object') && typeOk(v, 'object')) {
    for (const k of schema.required ?? []) if (!(k in v)) errs.push(`${at}.${k}: missing`);
    for (const k of Object.keys(v)) {
      if (!schema.properties?.[k]) errs.push(`${at}.${k}: not allowed`);
      else errs.push(...schemaErrors(v[k], schema.properties[k], `${at}.${k}`));
    }
  }
  if (Array.isArray(v) && schema.items) v.forEach((x, i) => errs.push(...schemaErrors(x, schema.items, `${at}[${i}]`)));
  return errs;
}

export function validateReport(report) {
  const errors = schemaErrors(report, REPORT_SCHEMA, 'report');
  if (errors.length) return errors;

  if (report.overall_score < 1 || report.overall_score > 10) errors.push('report.overall_score: must be 1-10');
  for (const [k] of RUBRIC) {
    const s = report.rubric[k].score;
    if (s < 1 || s > 5) errors.push(`report.rubric.${k}.score: must be 1-5`);
  }
  if (report.strengths.length !== 3) errors.push('report.strengths: must have 3 items');
  if (report.improvements.length !== 3) errors.push('report.improvements: must have 3 items');
  return errors;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(n) || lo)));

// True when `q` appears exactly inside one of the user's messages.
export function isVerbatim(q, userMessages) {
  return typeof q === 'string' && q.length > 0 && userMessages.some((m) => m.includes(q));
}

// Normalize a model report: clamp scores, keep 3 items per list, and drop every quote that isn't
// verbatim in the user's own messages (evidence -> null, rewrite -> null).
export function cleanReport(raw, userMessages) {
  const keep = (q) => {
    const t = typeof q === 'string' ? q.trim().replace(/^["“”']+|["“”']+$/g, '') : '';
    return isVerbatim(t, userMessages) ? t : null;
  };
  const list = (a) => (Array.isArray(a) ? a.map((s) => String(s).trim()).filter(Boolean).slice(0, 3) : []);
  const rubric = {};
  for (const [k] of RUBRIC) {
    const r = raw?.rubric?.[k] ?? {};
    rubric[k] = { score: clamp(r.score, 1, 5), evidence: keep(r.evidence), note: String(r.note ?? '').trim().slice(0, 400) };
  }
  const rw = raw?.rewrite;
  const original = rw ? keep(rw.original) : null;
  return {
    overall_score: clamp(raw?.overall_score, 1, 10),
    summary: String(raw?.summary ?? '').trim().slice(0, 600),
    rubric,
    strengths: list(raw?.strengths),
    improvements: list(raw?.improvements),
    rewrite: original ? { original, stronger: String(rw.stronger ?? '').trim().slice(0, 600), why: String(rw.why ?? '').trim().slice(0, 300) } : null,
    follow_up_message: String(raw?.follow_up_message ?? '').trim().slice(0, 1200),
  };
}

const REPORT_PROMPT = `You are a networking coach scoring a student's practice coffee chat with an AI persona.
Score only what the student (USER) wrote. Be honest and specific; a short or generic chat should score low.

Rubric (each 1-5):
- opening: how they started (greeting, context, why this person).
- curiosity: question quality: open, specific, informed by the person's background.
- listening: follow-ups that build on what the persona said.
- specificity: concrete details about themselves (school, projects, interests) instead of vague claims.
- ask: a clear, well-timed, appropriately sized ask for their goal (or none when none was appropriate yet).
- close: thanking them and setting up a next step.

For every "evidence" and for rewrite.original, copy text EXACTLY, character for character, from ONE of the numbered USER lines. Never paraphrase or quote the persona. Use null when no line fits.
overall_score is 1-10. Give exactly 3 strengths and 3 improvements. The follow-up message is from the student to the persona (use the persona's first name), ready to send.`;

export async function generateReport({ openai, model, scenario, history }) {
  const userMessages = history.filter((m) => m.role === 'user').map((m) => m.content);
  if (!openai) return mockReport(scenario, userMessages);
  const p = scenario.persona;
  let n = 0;
  const transcript = history
    .map((m) => (m.role === 'user' ? `USER [${++n}]: ${m.content}` : `${p.first_name.toUpperCase()}: ${m.content}`))
    .join('\n');
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: REPORT_PROMPT },
      {
        role: 'user',
        content: `Persona: ${p.first_name}, ${p.label}. Mood: ${MOODS[scenario.mood]}.\nStudent's goal for the chat: ${scenario.goal_label}\nMap goal: ${scenario.map_goal || 'not stated'}\n\nTranscript:\n${transcript}`,
      },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'practice_report', strict: true, schema: REPORT_SCHEMA } },
  });
  const msg = completion.choices[0]?.message;
  if (msg?.refusal) throw Object.assign(new Error(msg.refusal), { status: 422 });
  return cleanReport(JSON.parse(msg.content), userMessages);
}

// The first sentence of a message (or its first 160 characters): always a verbatim substring.
function firstSentence(text) {
  const m = String(text).match(/^[\s\S]*?[.?!](?=\s|$)/);
  return (m ? m[0] : String(text)).slice(0, 160).trim();
}
const findMsg = (msgs, re) => msgs.find((m) => re.test(m));

export function mockReport(scenario, userMessages) {
  const u = userMessages;
  const p = scenario.persona;
  const questions = u.filter((m) => m.includes('?'));
  const questionSentence = (m) => (m.match(/[^.?!]*\?/)?.[0] ?? m).trim().slice(0, 160);
  const aboutSelf = findMsg(u, /\b(I'm|I am|I've|my|I)\b/);
  const ask = findMsg(u, /\b(refer|referral|introduce|intro|advice|could you|would you|would it be|happy to)\b/i);
  const followUp = findMsg(u.slice(1), /\b(you mentioned|you said|that|earlier|how did|why did)\b/i);
  const thanks = findMsg(u, /\b(thank|thanks|appreciate)\b/i);
  const ev = (m, pick = firstSentence) => (m ? pick(m) : null);

  const rubric = {
    opening: { score: u[0] && u[0].length > 40 ? 4 : 3, evidence: ev(u[0]), note: u[0] && u[0].length > 40 ? 'You opened with context about yourself and why you reached out.' : 'Your opening was brief; add one line on why you picked this person.' },
    curiosity: { score: Math.min(5, 1 + questions.length), evidence: ev(questions[0], questionSentence), note: questions.length >= 3 ? 'You kept the conversation moving with several questions.' : 'Ask more open questions tied to their background.' },
    listening: { score: followUp ? 4 : 2, evidence: ev(followUp), note: followUp ? 'You built on something they said.' : 'Pick up on a detail they shared before moving to a new topic.' },
    specificity: { score: aboutSelf ? 3 : 2, evidence: ev(aboutSelf), note: aboutSelf ? 'You shared something concrete about yourself.' : 'Mention a specific class, project or interest so they can help.' },
    ask: { score: ask ? 4 : 2, evidence: ev(ask), note: ask ? 'You made a clear ask.' : 'You never made an ask. Close with one small, specific request.' },
    close: { score: thanks ? 4 : 2, evidence: ev(thanks), note: thanks ? 'You thanked them for their time.' : 'End by thanking them and proposing a next step.' },
  };
  const avg = Object.values(rubric).reduce((a, r) => a + r.score, 0) / RUBRIC.length;
  const overall = clamp(avg * 2 - (u.length < 3 ? 1 : 0), 1, 10);
  const shortest = [...u].sort((a, b) => a.length - b.length)[0];

  return {
    overall_score: overall,
    summary: `Demo feedback: ${u.length} ${u.length === 1 ? 'message' : 'messages'}, ${questions.length} with a question. Add an OpenAI key for a full review of this chat.`,
    rubric,
    strengths: [
      questions.length ? 'You asked questions instead of only talking about yourself.' : 'You kept your messages short and easy to answer.',
      followUp ? 'You followed up on what you heard.' : 'You stayed polite and on topic.',
      thanks ? 'You thanked them for their time.' : 'You showed up with a clear goal for the chat.',
    ],
    improvements: [
      followUp ? 'Go one level deeper on their answers before switching topics.' : 'Follow up on one detail they share before asking something new.',
      aboutSelf ? 'Tie what you share about yourself to their work.' : 'Share one concrete project or class so they know how to help.',
      ask ? 'Make the ask small and easy to say yes to.' : 'End with a small, specific ask, such as a 15-minute follow-up.',
    ],
    rewrite: shortest
      ? {
        original: shortest,
        stronger: `I read that you work on ${p.title || 'this'}${p.organization ? ` at ${p.organization}` : ''}. What's one decision from the last few months you're proud of, and how did you make it?`,
        why: 'It shows you did your homework and invites a story instead of a yes or no.',
      }
      : null,
    follow_up_message: `Hi ${p.first_name}, thank you for taking the time to chat today. I really appreciated hearing about your path${p.organization ? ` at ${p.organization}` : ''}. I'm going to act on your advice and would love to send you a short update in a few weeks. Thanks again!`,
  };
}
