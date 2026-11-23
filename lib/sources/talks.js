// Conference talks from public speaker pages: Sessionize (speaker profiles), Speaker Deck (slides) and
// Notist (talks with slides). Pages are read through Exa, never fetched directly. A speaker page
// names the speaker and usually lists their links, which is how it is tied to the person.

import { exaContents, exaSearch } from './exa.js';
import { TALK_SITES, talkPage, clip } from './links.js';

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

// "Ada Example (@adaex) on Speaker Deck", "Ada Example's Speaker Profile | Sessionize" -> "Ada Example".
export function speakerName(title) {
  const t = String(title ?? '')
    .split(/\s[|–—-]\s/)[0]
    .replace(/\(@[^)]*\)/g, '')
    .replace(/['’]s\b.*$/i, '')
    .replace(/\s+on\s+(speaker deck|notist|sessionize)\b.*$/i, '')
    .replace(/^(presentations|talks|slides)\s+by\s+/i, '')
    .trim();
  return t && t.split(/\s+/).length <= 5 && !/\d/.test(t) && !/^(speaker deck|notist|sessionize)$/i.test(t) ? t : '';
}

// A talk's title from its page title ("Fast Queries by Ada Example - Speaker Deck"), or its slug.
function talkTitle(title, slug, speaker) {
  let t = String(title ?? '').split(/\s[|–—]\s|\s-\s(?=(speaker deck|notist|sessionize)\b)/i)[0].trim();
  if (speaker) t = t.replace(new RegExp(`\\s+(by|from)\\s+${speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*$`, 'i'), '').trim();
  if (!t || /^(speaker deck|notist|sessionize)$/i.test(t)) t = String(slug ?? '').replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  return t;
}

// Sessionize profiles list their sessions under a "Sessions" heading.
function sessionizeTalks(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.trim());
  const start = lines.findIndex((l) => /^#{1,4}\s*sessions\b/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,4}\s*(events|topics|area of expertise|links|speaking history)\b/i.test(l)) break;
    const h = l.match(/^#{2,5}\s+(.+)$/) ?? l.match(/^\*\*(.+)\*\*$/);
    if (h && h[1].split(/\s+/).length >= 2) out.push(h[1].replace(/[*_`]/g, '').trim());
  }
  return out;
}

// Reads speaker pages (profile URLs from links.talkPage) with a few of their talk pages.
export async function readTalkProfiles(ctx, profiles) {
  if (!profiles.length) return [];
  const pages = await exaContents(ctx, profiles, { chars: 6000, links: 80, subpages: 4, subpageTarget: ['talk', 'slides', 'session', 'presentation'] });
  return pages.map((p) => {
    const tp = talkPage(p.url);
    if (!tp) return null;
    const name = speakerName(p.title);
    const talks = new Map();
    for (const s of p.subpages) {
      const t = talkPage(s.url);
      if (t?.talk && t.user === tp.user) talks.set(t.talk, { title: talkTitle(s.title, t.slug, name), url: t.talk, date: s.date, event: eventIn(s.text) });
    }
    for (const l of p.links) {
      const t = talkPage(l);
      if (t?.talk && t.user === tp.user && !talks.has(t.talk)) talks.set(t.talk, { title: talkTitle('', t.slug, name), url: t.talk, date: null, event: '' });
    }
    if (tp.site === 'sessionize.com') for (const title of sessionizeTalks(p.text)) talks.set(`${tp.profile}#${title}`, { title, url: tp.profile, date: null, event: '' });
    return { url: tp.profile, site: TALK_SITES[tp.site], name, text: p.text, links: p.links, talks: [...talks.values()].filter((t) => t.title).slice(0, 6) };
  }).filter(Boolean);
}

// "Presented at Data Days 2025" / "Event: Data Days" / "Data Days · March 2025": a short event label.
function eventIn(text) {
  const t = String(text ?? '');
  const m = t.match(/(?:presented at|given at|event:)\s*([^\n.·|]{3,80})/i) ?? t.match(new RegExp(`^([^\\n]{3,60}?)\\s*[·|,-]\\s*${MONTH}\\s+\\d{4}`, 'im'));
  return m ? clip(m[1], 80) : '';
}

// Speaker pages that might be theirs, found by name. Only candidates: each still has to link back.
export async function findTalkProfiles(ctx, name, max = 2) {
  const results = await exaSearch(ctx, `${name} speaker`, { domains: Object.keys(TALK_SITES), num: 6, chars: 300, links: 0 });
  const profiles = [];
  for (const r of results) {
    const t = talkPage(r.url);
    if (t && !profiles.includes(t.profile)) profiles.push(t.profile);
  }
  return profiles.slice(0, max);
}
