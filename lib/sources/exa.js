// Exa contents: the text of pages Exa has already crawled, plus the links on them
// (extras.links). Netsearch never fetches a person's pages itself; it asks Exa, which crawls
// and licenses them. One call can read several pages.

import { SourceError } from './http.js';

const CONTENTS_URL = 'https://api.exa.ai/contents';

export async function exaContents(ctx, urls, { chars = 4000, links = 40 } = {}) {
  if (!urls.length) return [];
  let data;
  try {
    data = await ctx.fetchJson(CONTENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.exaKey },
      body: JSON.stringify({ urls, text: { maxCharacters: chars }, extras: { links } }),
      timeoutMs: 25_000,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new SourceError('Exa rejected the API key. Check EXA_API_KEY in your .env file.', { status: 502 });
    if (err.status === 402) throw new SourceError('Your Exa account is out of credits.', { status: 502 });
    throw err;
  }
  return (Array.isArray(data?.results) ? data.results : []).map((r) => ({
    url: r.url,
    title: String(r.title ?? ''),
    text: String(r.text ?? ''),
    links: Array.isArray(r.extras?.links) ? r.extras.links.map(String) : [],
    person: r.entities?.find((e) => e.type === 'person')?.properties ?? null,
  }));
}
