// URLs and names: contact scrubbing, one spelling per profile URL, telling which links are
// accounts we can read (GitHub, ORCID) or a personal site, and whether two names can be the
// same person. Contact scrubbing and URL canonicalizing are ported from TempNetsearch PR #4
// (sources/candidate.js).

// Emails, phone numbers and street addresses are never collected or shown.
const EMAIL = /[A-Z0-9._%+-]+\s*(?:@|\[at\]|\(at\))\s*[A-Z0-9.-]+\s*(?:\.|\[dot\]|\(dot\))\s*[A-Z]{2,}/gi;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]\d{3,4}(?:[\s.-]\d{2,4})?/g;
// Case-sensitive on purpose: "221 Baker Street", not "5 years at the way".
const STREET = /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){0,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Apt|Suite|Unit)\b\.?/g;

export function scrubContact(text) {
  return String(text ?? '')
    .replace(/mailto:\S+/gi, '')
    .replace(EMAIL, '')
    .replace(STREET, '')
    .replace(PHONE, (m) => (/^\d{4}\s*[-–]\s*\d{4}$/.test(m.trim()) ? m : '')) // keep "2019-2023"
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Scrubbed, one line, at most n characters.
export function clip(text, n) {
  const t = scrubContact(String(text ?? '').replace(/\s+/g, ' '));
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function normalizeUrl(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw) && !/^https?:\/\//i.test(raw)) return null; // mailto:, javascript:, ftp:
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

// https, no www/m., LinkedIn country subdomains folded, no query or hash, no trailing slash,
// lower-case paths where the site ignores case.
export function canonicalUrl(url) {
  const n = normalizeUrl(url);
  if (!n) return null;
  const u = new URL(n);
  let host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (/(^|\.)linkedin\.com$/.test(host)) host = 'linkedin.com';
  if (host === 'twitter.com') host = 'x.com';
  let path = u.pathname.replace(/\/+$/, '');
  try {
    path = decodeURI(path);
  } catch {}
  if (['github.com', 'linkedin.com', 'x.com'].includes(host)) path = path.toLowerCase();
  if (host === 'orcid.org') path = path.toUpperCase();
  if (host === 'doi.org' || host === 'dx.doi.org') return `https://doi.org${path.toLowerCase()}`;
  return `https://${host}${path}`;
}

export const hostOf = (url) => {
  try {
    return new URL(normalizeUrl(url)).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
};

// github.com/<login>: a user page, not a repo, org feature page or GitHub's own pages.
const GITHUB_RESERVED = new Set(['about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'events', 'explore', 'features', 'issues', 'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls', 'search', 'security', 'settings', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users']);
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

export function githubLogin(url) {
  const n = normalizeUrl(url);
  if (!n || hostOf(n) !== 'github.com') return null;
  const parts = new URL(n).pathname.split('/').filter(Boolean);
  if (parts.length !== 1 || GITHUB_RESERVED.has(parts[0].toLowerCase()) || !LOGIN.test(parts[0])) return null;
  return parts[0];
}

export function githubRepo(url) {
  const n = normalizeUrl(url);
  if (!n || hostOf(n) !== 'github.com') return null;
  const [owner, repo, ...rest] = new URL(n).pathname.split('/').filter(Boolean);
  if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase()) || !LOGIN.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) return null;
  if (rest.length && !['tree', 'blob', 'wiki', 'releases'].includes(rest[0])) return null;
  return { owner, repo: repo.replace(/\.git$/, '') };
}

const ORCID = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i;
export function orcidId(url) {
  const n = normalizeUrl(url);
  if (!n || hostOf(n) !== 'orcid.org') return null;
  const m = new URL(n).pathname.match(ORCID);
  return m ? m[1].toUpperCase() : null;
}

// Hosts that are never someone's own site: social networks, profile aggregators, link
// directories, knowledge bases, and sources that get their own module.
const PLATFORMS = [
  'linkedin.com', 'github.com', 'orcid.org', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'threads.net', 'tiktok.com',
  'youtube.com', 'youtu.be', 'bsky.app', 'mastodon.social', 'reddit.com', 'pinterest.com', 'snapchat.com', 'discord.com', 'discord.gg',
  'crunchbase.com', 'imdb.com', 'viaf.org', 'isni.org', 'wikipedia.org', 'wikidata.org', 'google.com', 'scholar.google.com',
  'researchgate.net', 'academia.edu', 'angel.co', 'wellfound.com', 'about.me', 'linktr.ee', 'bit.ly', 'calendly.com', 'zoominfo.com',
  'rocketreach.co', 'apollo.io', 'signalhire.com', 'lusha.com', 'spokeo.com', 'whitepages.com', 'medium.com', 'substack.com', 'dev.to',
  'stackoverflow.com', 'huggingface.co', 'kaggle.com', 'behance.net', 'dribbble.com', 'apple.com', 'microsoft.com', 'amazon.com',
];
const isPlatform = (host) => PLATFORMS.some((p) => host === p || host.endsWith(`.${p}`));

// A link that could be the person's own site: not a platform, not an employer's domain.
export function maybeOwnSite(url, companies = []) {
  const host = hostOf(url);
  if (!host || isPlatform(host)) return false;
  const label = host.split('.').slice(-2, -1)[0] ?? '';
  const employer = companies.map((c) => String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).filter((c) => c.length > 2);
  return !employer.some((c) => label === c || (label.length > 3 && c.startsWith(label)));
}

// ---------------------------------------------------------------------------
// Names: "is this account's name compatible with the person's?"
// ---------------------------------------------------------------------------

const tokens = (name) =>
  String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !['dr', 'mr', 'ms', 'mrs', 'phd', 'mba', 'jr', 'sr'].includes(t));

const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

// 'match' (two or more names agree), 'partial' (one), 'none' (a real name that shares nothing),
// or 'unknown' (no name, or just a handle).
export function nameVerdict(personName, accountName, handle = '') {
  const theirs = tokens(accountName);
  if (!theirs.length || (theirs.length === 1 && theirs[0] === String(handle).toLowerCase())) return 'unknown';
  const ours = tokens(personName);
  const hits = theirs.filter((t) => ours.some((o) => same(o, t))).length;
  return hits >= 2 || (hits === 1 && theirs.length === 1 && ours.length === 1) ? 'match' : hits === 1 ? 'partial' : 'none';
}

// True when the text (a page title or opening) carries the person's first and last name.
export function mentionsName(text, personName) {
  const ours = tokens(personName);
  if (ours.length < 2) return false;
  const words = new Set(tokens(text));
  return words.has(ours[0]) && words.has(ours[ours.length - 1]);
}

// 'match' | 'other' | 'unknown': does an account's company agree with any employer on the profile?
export function companyVerdict(company, experience = []) {
  const c = String(company ?? '').replace(/^@/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c.length < 2) return 'unknown';
  const known = experience.map((x) => String(x?.company ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
  if (!known.length) return 'unknown';
  return known.some((k) => k.includes(c) || c.includes(k)) ? 'match' : 'other';
}

// Do two lists of organization names share one? Every distinctive word of the shorter name has to
// appear in the other ("University of Washington" ~ "Univ. of Washington, Seattle"), so one shared
// common word is not enough.
const ORG_STOP = new Set(['the', 'of', 'for', 'and', 'at', 'in', 'on', 'university', 'univ', 'institute', 'inst', 'college', 'school', 'department', 'dept', 'center', 'centre', 'lab', 'labs', 'laboratory', 'inc', 'llc', 'ltd', 'corp', 'corporation', 'company', 'group', 'foundation', 'gmbh', 'plc', 'technologies', 'technology', 'national', 'research', 'sciences', 'science', 'global', 'international', 'state']);
const orgTokens = (s) =>
  String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !ORG_STOP.has(t));

export function orgsOverlap(a = [], b = []) {
  for (const x of a) {
    const tx = orgTokens(x);
    if (!tx.length) continue;
    for (const y of b) {
      const ty = orgTokens(y);
      if (!ty.length) continue;
      const shared = tx.filter((t) => ty.includes(t)).length;
      if (shared && shared === Math.min(tx.length, ty.length)) return true;
    }
  }
  return false;
}
