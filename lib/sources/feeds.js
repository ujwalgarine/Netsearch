// RSS and Atom feeds for Medium (medium.com/feed/@user) and Substack (<name>.substack.com/feed):
// one call each, no key. Only titles, dates, links, categories and a short summary are kept; the
// post bodies (content:encoded) are never read.

import { decodeEntities } from './links.js';

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? text(m[1]) : '';
};
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'gi'))].map((m) => text(m[1])).filter(Boolean);
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\b[^>]*\\b${a}="([^"]*)"`, 'i'))?.[1] ?? '';
// CDATA unwrapped, markup removed, entities decoded, one line. Titles and summaries are often HTML
// inside XML (Atom type="html", or escaped HTML in RSS), so entities are decoded on both sides of
// removing the markup.
const text = (s) => decodeEntities(decodeEntities(String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function isoDate(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function parseFeed(xml) {
  const doc = String(xml ?? '').replace(/<content:encoded>[\s\S]*?<\/content:encoded>/gi, '');
  const atom = /<feed\b/i.test(doc) && !/<rss\b/i.test(doc);
  const entries = [...doc.matchAll(atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const head = doc.split(atom ? /<entry\b/i : /<item\b/i)[0];
  return {
    title: tag(head, 'title'),
    author: tag(head, 'itunes:author') || tag(head.match(/<author\b[^>]*>([\s\S]*?)<\/author>/i)?.[1] ?? '', 'name'),
    items: entries.map((e) => ({
      title: tag(e, 'title'),
      url: atom ? attr(e.match(/<link\b[^>]*rel="alternate"[^>]*>/i)?.[0] ?? e, 'link', 'href') : tag(e, 'link'),
      date: isoDate(tag(e, 'pubDate') || tag(e, 'published') || tag(e, 'updated') || tag(e, 'dc:date')),
      author: tag(e, 'dc:creator') || tag(e, 'name'),
      summary: tag(e, 'description') || tag(e, 'summary') || tag(e, 'subtitle'),
      categories: atom ? [...e.matchAll(/<category\b[^>]*\bterm="([^"]*)"/gi)].map((m) => decodeEntities(m[1])) : tags(e, 'category'),
    })).filter((it) => it.title && /^https?:\/\//.test(it.url)),
  };
}

// The post URL without Medium's tracking query (?source=rss-…).
const clean = (url) => {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
};

// account: from links.writingAccount (platform 'medium' or 'substack').
export async function feedWriter(ctx, account) {
  const xml = await ctx.fetchText(account.feed);
  if (!xml) return null;
  const feed = parseFeed(xml);
  const byLine = account.platform === 'medium' ? feed.title.match(/^Stories by (.+?) on Medium$/i)?.[1] : null;
  const authors = feed.items.map((i) => i.author).filter(Boolean);
  const top = authors.sort((a, b) => authors.filter((x) => x === b).length - authors.filter((x) => x === a).length)[0];
  return {
    url: account.url,
    handle: account.key,
    name: byLine || top || feed.author || '',
    title: feed.title,
    posts: feed.items.slice(0, 8).map((i) => ({ title: i.title, url: clean(i.url), date: i.date, summary: i.summary, tags: i.categories.slice(0, 5), reactions: 0 })),
  };
}
