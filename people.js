// Real people for a branch: Exa people search finds public profiles, then the model
// writes details and talking points grounded only in what each profile says.

const EXA_URL = 'https://api.exa.ai/search';
const PROFILE_CHARS = 2200; // profile text the model sees per person

export class UpstreamError extends Error {
  constructor(source, status, message) {
    super(message);
    this.source = source;
    this.status = status;
  }
}

export async function exaPeopleSearch(apiKey, query, numResults) {
  const res = await fetch(EXA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      query,
      type: 'auto',
      category: 'people',
      numResults,
      contents: { text: { maxCharacters: PROFILE_CHARS } },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[exa]', res.status, body.slice(0, 500));
    const hint =
      res.status === 401 || res.status === 403
        ? 'Exa rejected the API key. Check EXA_API_KEY in your .env file.'
        : res.status === 402
          ? 'Your Exa account is out of credits. The free balance resets on the 1st of each month.'
          : res.status === 429
            ? 'Exa rate limit hit. Wait a few seconds and try again.'
            : 'People search failed. Check the server terminal for details.';
    throw new UpstreamError('exa', res.status, hint);
  }

  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

// Pull the structured fields Exa returns for person results (when present).
function facts(result) {
  const p = result.entities?.find((e) => e.type === 'person')?.properties ?? {};
  const experience = (p.workHistory ?? [])
    .filter((w) => w?.title || w?.company?.name)
    .slice(0, 4)
    .map((w) => ({
      title: w.title ?? '',
      company: w.company?.name ?? '',
      from: w.dates?.from ?? null,
      to: w.dates?.to ?? null,
    }));
  const education = (p.educationHistory ?? [])
    .filter((e) => e?.institution?.name)
    .slice(0, 3)
    .map((e) => ({
      school: e.institution.name,
      degree: e.degree ?? '',
      from: e.dates?.from ?? null,
      to: e.dates?.to ?? null,
    }));
  return { name: p.name ?? null, location: p.location ?? null, experience, education };
}

// "Jane Doe - Product Manager - Microsoft | LinkedIn" -> "Jane Doe"
const nameFromTitle = (title = '') => title.split(/\s[-|–—]\s|\s\|\s/)[0].trim();

const fmtRange = (from, to) => [from, to ?? 'present'].filter(Boolean).join(' – ');

function describeCandidate(i, r, f) {
  const lines = [`[${i}] ${f.name || nameFromTitle(r.title)}`, `Page title: ${r.title ?? ''}`, `URL: ${r.url}`];
  if (f.location) lines.push(`Location: ${f.location}`);
  if (f.experience.length)
    lines.push('Experience: ' + f.experience.map((x) => `${x.title} @ ${x.company} (${fmtRange(x.from, x.to)})`).join('; '));
  if (f.education.length)
    lines.push('Education: ' + f.education.map((x) => `${x.degree} ${x.school}`.trim()).join('; '));
  if (r.text) lines.push(`Profile text:\n${r.text.slice(0, PROFILE_CHARS)}`);
  return lines.join('\n');
}

const enrichSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['people'],
  properties: {
    people: {
      type: 'array',
      description: 'One entry per candidate, best fit first',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'relevant', 'name', 'headline', 'summary', 'why', 'in_common', 'talking_points'],
        properties: {
          index: { type: 'integer', description: 'The [n] number of the candidate' },
          relevant: { type: 'boolean', description: 'False if this is not a real individual profile or clearly does not fit the branch' },
          name: { type: 'string', description: 'Full name exactly as it appears on the profile' },
          headline: { type: 'string', description: 'Current role and organization, e.g. "Product Manager at Microsoft"' },
          summary: { type: 'string', description: '2-3 sentences on their background, using only facts from the profile' },
          why: { type: 'string', description: 'One sentence on why they are worth meeting for this user and goal' },
          in_common: {
            type: 'array',
            items: { type: 'string' },
            description: 'Real overlaps with the user (same school, past employer, city, field). Empty if none are stated.',
          },
          talking_points: {
            type: 'array',
            items: { type: 'string' },
            description: '3 specific openers, each tied to something on their profile and to the user',
          },
        },
      },
    },
  },
};

const ENRICH_PROMPT = `You prepare a user to reach out to real people found by a people search.
For each numbered candidate, decide if they fit the branch, then write details and talking points.

Rules:
- Use ONLY facts in the candidate's profile. Never invent employers, schools, projects, or dates.
- If a fact isn't on the profile, leave it out rather than guessing.
- Talking points must reference something specific on their profile (a role, project, move, school, post) and connect it to the user's goal. No generic questions like "tell me about your journey".
- in_common lists only overlaps that are stated for BOTH the user and the candidate.
- Mark relevant=false for company pages, job listings, duplicates, or people who clearly don't match the branch.`;

export async function enrichPeople({ openai, model, goal, profile, branch, results }) {
  const candidates = results.map((r) => ({ r, f: facts(r) }));
  const userBlock = [
    `User goal: ${goal || '(not stated)'}`,
    `About the user: ${profile || '(not stated)'}`,
    `Branch: ${branch.label}${branch.why ? ` (${branch.why})` : ''}`,
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: ENRICH_PROMPT },
      { role: 'user', content: `${userBlock}\n\nCandidates:\n\n${candidates.map(({ r, f }, i) => describeCandidate(i, r, f)).join('\n\n---\n\n')}` },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'people', strict: true, schema: enrichSchema } },
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new UpstreamError('openai', 422, message.refusal);
  const { people } = JSON.parse(message.content);

  const seen = new Set();
  return people
    .filter((p) => p.relevant && candidates[p.index] && !seen.has(p.index) && seen.add(p.index))
    .map((p) => {
      const { r, f } = candidates[p.index];
      const current = f.experience.find((x) => !x.to) ?? null;
      return {
        id: r.url,
        name: f.name || p.name || nameFromTitle(r.title),
        headline: p.headline || (current ? `${current.title} at ${current.company}` : ''),
        location: f.location,
        url: r.url,
        image: r.image ?? null,
        summary: p.summary,
        why: p.why,
        in_common: p.in_common,
        talking_points: p.talking_points,
        experience: f.experience,
        education: f.education,
      };
    });
}
