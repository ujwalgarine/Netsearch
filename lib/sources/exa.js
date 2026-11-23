// Exa contents: the text of pages Exa has already crawled, plus the links on them (extras.links)
// and, when asked, a few of their subpages (a site's blog posts, a speaker page's talks). Exa search
// finds speaker pages by name. Netsearch never fetches a person's own pages itself; it asks Exa,
// which crawls and licenses them. One call can read several pages.

import { SourceError } from './http.js';

const CONTENTS_URL = 'https://api.exa.ai/contents';
const SEARCH_URL = 'https://api.exa.ai/search';

async function post(ctx, url, body) {
  try {
    return await ctx.fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ctx.exaKey },
      body: JSON.stringify(body),
      timeoutMs: 25_000,
    });
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw new SourceError('Exa rejected the API key. Check EXA_API_KEY in your .env file.', { status: 502 });
    if (err.status === 402) throw new SourceError('Your Exa account is out of credits.', { status: 502 });
    throw err;
  }
}

const page = (r) => ({
  url: r.url,
  title: String(r.title ?? ''),
  text: String(r.text ?? ''),
  date: r.publishedDate || null,
  links: Array.isArray(r.extras?.links) ? r.extras.links.map(String) : [],
  person: r.entities?.find((e) => e.type === 'person')?.properties ?? null,
  subpages: Array.isArray(r.subpages) ? r.subpages.filter((x) => x?.url).map((x) => ({ url: x.url, title: String(x.title ?? ''), text: String(x.text ?? ''), date: x.publishedDate || null })) : [],
});

export async function exaContents(ctx, urls, { chars = 4000, links = 40, subpages = 0, subpageTarget = null } = {}) {
  if (!urls.length) return [];
  const body = { urls, text: { maxCharacters: chars }, extras: { links } };
  if (subpages) Object.assign(body, { subpages, ...(subpageTarget ? { subpageTarget } : {}) });
  const data = await post(ctx, CONTENTS_URL, body);
  return (Array.isArray(data?.results) ? data.results : []).map(page);
}

// A keyword search limited to a few sites, with a little text and the links on each result.
export async function exaSearch(ctx, query, { domains = [], num = 5, chars = 800, links = 40 } = {}) {
  const data = await post(ctx, SEARCH_URL, {
    query,
    numResults: num,
    includeDomains: domains,
    contents: { text: { maxCharacters: chars }, extras: { links } },
  });
  return (Array.isArray(data?.results) ? data.results : []).map(page);
}
