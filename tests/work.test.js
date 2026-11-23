// Work and projects: link and name rules, the lookup against saved sample responses (shaped like
// the real Exa, GitHub, ORCID and OpenAlex answers), the routes on a bare app with an in-memory
// store, the coffee chat partner's themes, and a Supabase block like api.test.js (skipped without it).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { canonicalUrl, githubLogin, githubRepo, orcidId, maybeOwnSite, nameVerdict, companyVerdict, mentionsName, scrubContact, writingAccount, stackOverflowUser, talkPage } from '../lib/sources/links.js';
import { parseFeed } from '../lib/sources/feeds.js';
import { speakerName } from '../lib/sources/talks.js';
import { createFetcher } from '../lib/sources/http.js';
import { findWork, generalThemes, isStale, nameParts, plainPrep } from '../lib/enrich.js';
import { workRoutes } from '../lib/work.js';
import * as practice from '../lib/practice.js';
import { Client, configured, makeEmail, signUp as signUpAs, deleteAccounts, startServer } from './helpers.js';

const NOW = new Date('2026-11-19T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// Sample answers
// ---------------------------------------------------------------------------

const PROFILE = 'https://linkedin.com/in/ada-example';
const ADA = {
  id: PROFILE,
  url: PROFILE,
  name: 'Ada Example',
  headline: 'Software Engineer at Contoso',
  experience: [{ title: 'Software Engineer', company: 'Contoso' }],
  talking_points: ['Ask about the move to Contoso.'],
};

const exaProfile = (over = {}) => ({
  url: PROFILE,
  title: 'Ada Example',
  text: '# Ada Example\n\nSoftware Engineer at Contoso\n\n## About\n\nI write about data tools at https://adaexample.dev\n\n## Experience\n\n### Software Engineer - Contoso (Current)\n\n- Maintainer of the Contoso SQL tools https://github.com/contoso/sqltools\n- Reach me at ada@example.com or 206-555-0142',
  extras: { links: ['linkedin.com/in/ada-example', 'adaexample.dev', 'crunchbase.com/person/ada-example', 'contoso.com/careers'] },
  entities: [{ type: 'person', properties: { name: 'Ada Example' } }],
  ...over,
});
const exaSite = (over = {}) => ({
  url: 'https://adaexample.dev/',
  title: 'Ada Example · data tools',
  text: "Hi, I'm Ada Example. I build small tools for working with data. Write to ada@example.com.",
  extras: { links: ['https://github.com/adaex', 'https://orcid.org/0000-0002-1825-0097', 'https://github.com/someone-else/cool-thing'] },
  ...over,
});
const ghUser = (over = {}) => ({ login: 'adaex', type: 'User', name: 'Ada Example', company: '@contoso', blog: 'https://adaexample.dev', html_url: 'https://github.com/adaex', email: 'ada@example.com', bio: 'Data tools.', ...over });
const ghRepos = () => [
  { full_name: 'adaex/querykit', name: 'querykit', html_url: 'https://github.com/adaex/querykit', description: 'Tiny SQL query builder. Questions: ada@example.com', language: 'TypeScript', stargazers_count: 41, pushed_at: daysAgo(10), fork: false, archived: false },
  { full_name: 'adaex/forked', name: 'forked', html_url: 'https://github.com/adaex/forked', description: 'A fork', pushed_at: daysAgo(2), fork: true },
  { full_name: 'adaex/old-thing', name: 'old-thing', html_url: 'https://github.com/adaex/old-thing', description: 'From long ago', pushed_at: '2019-01-01T00:00:00Z', fork: false },
  { full_name: 'adaex/archived', name: 'archived', html_url: 'https://github.com/adaex/archived', pushed_at: daysAgo(30), fork: false, archived: true },
];
const ghSocial = () => [{ provider: 'linkedin', url: 'https://www.linkedin.com/in/ada-example/' }];
const ghRepo = () => ({ full_name: 'contoso/sqltools', html_url: 'https://github.com/contoso/sqltools', description: 'SQL tools for Contoso databases', stargazers_count: 310, pushed_at: daysAgo(3) });

// The real ORCID record shape (pub.orcid.org/v3.0/{id}/record), trimmed.
const orcid = (given = 'Ada', family = 'Example') => ({
  person: {
    name: { 'given-names': { value: given }, 'family-name': { value: family }, 'credit-name': null },
    'researcher-urls': { 'researcher-url': [{ 'url-name': 'Website', url: { value: 'https://adaexample.dev' } }] },
  },
  'activities-summary': {
    works: {
      group: [
        { 'external-ids': { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': '10.5555/12345680', 'external-id-relationship': 'self' }] }, 'work-summary': [{ title: { title: { value: 'Measuring Query Latency' } }, 'publication-date': { year: { value: '2025' } }, 'journal-title': { value: 'Journal of Data' }, type: 'journal-article' }] },
        { 'external-ids': { 'external-id': [] }, 'work-summary': [{ title: { title: { value: 'Notes on Small Data Tools' } }, 'publication-date': { year: { value: '2023' } }, 'journal-title': null, type: 'report' }] },
      ],
    },
    employments: {
      'affiliation-group': [
        { summaries: [{ 'employment-summary': { 'role-title': 'Affiliate Researcher', 'department-name': 'Data Lab', 'start-date': { year: { value: '2024' } }, 'end-date': null, organization: { name: 'Example University', address: { city: 'Seattle' } } } }] },
        { summaries: [{ 'employment-summary': { 'role-title': 'Intern', 'start-date': { year: { value: '2019' } }, 'end-date': { year: { value: '2019' } }, organization: { name: 'Old Co' } } }] },
      ],
    },
  },
});
const alex = () => ({
  results: [{ id: 'https://openalex.org/W1', display_name: 'Measuring query latency', publication_date: '2025-03-01', cited_by_count: 7, doi: 'https://doi.org/10.5555/12345680', primary_location: { source: { display_name: 'Journal of Data' } }, type: 'article' }],
});

// DEV (dev.to/api): the real field names and formats, from a live response.
const devUser = (over = {}) => ({ type_of: 'user', id: 1, username: 'adaex', name: 'Ada Example', twitter_username: null, github_username: 'adaex', summary: 'Data tools. Write me at ada@example.com', location: 'Seattle', website_url: 'https://adaexample.dev', joined_at: 'Dec 27, 2015', profile_image: 'https://media.dev.to/a.png', ...over });
const devArticle = (over = {}) => ({
  type_of: 'article', id: 5049015, title: 'Why query builders should be boring', description: 'Notes from two years of maintaining querykit, and why fewer features...', readable_publish_date: 'Nov 16', slug: 'why-query-builders-should-be-boring-1abc', path: '/adaex/why-query-builders-should-be-boring-1abc', url: 'https://dev.to/adaex/why-query-builders-should-be-boring-1abc', comments_count: 13, public_reactions_count: 79, positive_reactions_count: 79, collection_id: null, published_timestamp: '2026-11-16T15:30:03Z', created_at: '2026-11-16T15:30:03Z', published_at: '2026-11-16T15:30:03Z', edited_at: null, reading_time_minutes: 4, tag_list: ['sql', 'typescript', 'opensource'], tags: 'sql, typescript, opensource',
  user: { name: 'Ada Example', username: 'adaex', twitter_username: null, github_username: 'adaex', user_id: 1, website_url: 'https://adaexample.dev', profile_image: '', profile_image_90: '' },
  ...over,
});
const devArticles = () => [devArticle(), devArticle({ id: 2, title: 'Our team newsletter', url: 'https://dev.to/contoso/our-team-newsletter-2', user: { name: 'Contoso', username: 'contoso' } })];

// Medium and Substack feeds: the real structure (RSS 2.0, CDATA, RFC 822 dates), from live feeds.
const mediumFeed = () => `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:cc="http://cyber.law.harvard.edu/rss/creativeCommonsRssModule.html"><channel><title><![CDATA[Stories by Ada Example on Medium]]></title><description><![CDATA[Stories by Ada Example on Medium]]></description><link>https://medium.com/@adaex?source=rss-268314bb7e7e------2</link><image><url>https://cdn-images-1.medium.com/fit/c/150/150/a.png</url><title>Stories by Ada Example on Medium</title><link>https://medium.com/@adaex?source=rss-268314bb7e7e------2</link></image><generator>Medium</generator><lastBuildDate>Fri, 16 Oct 2026 20:46:56 GMT</lastBuildDate><atom:link href="https://medium.com/@adaex/feed" rel="self" type="application/rss+xml"/><webMaster><![CDATA[yourfriends@medium.com]]></webMaster><atom:link href="http://medium.superfeedr.com" rel="hub"/><item><title><![CDATA[Indexes I wish I’d added sooner]]></title><link>https://medium.com/@adaex/indexes-i-wish-id-added-sooner-0126fa5c6ce8?source=rss-268314bb7e7e------2</link><guid isPermaLink="false">https://medium.com/p/0126fa5c6ce8</guid><category><![CDATA[postgres]]></category><category><![CDATA[databases]]></category><dc:creator><![CDATA[Ada Example]]></dc:creator><pubDate>Thu, 12 Dec 2024 17:11:33 GMT</pubDate><atom:updated>2025-05-19T19:09:35.029Z</atom:updated><content:encoded><![CDATA[<p>Call me: 206-555-0142. <a href="mailto:ada@example.com">mail</a></p>]]></content:encoded></item></channel></rss>`;
const substackFeed = () => `<?xml version="1.0" encoding="UTF-8"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom" version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:googleplay="http://www.google.com/schemas/play-podcasts/1.0"><channel><title><![CDATA[Small Data Notes]]></title><description><![CDATA[Notes on small data tools]]></description><link>https://adanotes.substack.com</link><generator>Substack</generator><lastBuildDate>Tue, 03 Nov 2026 04:35:04 GMT</lastBuildDate><language><![CDATA[en]]></language><item><title><![CDATA[Picking a database for a side project]]></title><description><![CDATA[What I check first, and what I ignore]]></description><link>https://adanotes.substack.com/p/picking-a-database</link><guid isPermaLink="false">https://adanotes.substack.com/p/picking-a-database</guid><pubDate>Fri, 30 Oct 2026 17:03:17 GMT</pubDate><enclosure url="https://substack-post-media.s3.amazonaws.com/public/images/a.png" length="0" type="image/jpeg"/><content:encoded><![CDATA[<p>...</p>]]></content:encoded></item></channel></rss>`;

// Stack Exchange API 2.3 (shapes from its documentation: items, quota fields, unix dates, HTML entities).
const seUser = (over = {}) => ({ items: [{ badge_counts: { bronze: 12, silver: 5, gold: 1 }, account_id: 99, is_employee: false, creation_date: 1400000000, user_type: 'registered', user_id: 4242, location: 'Seattle, WA', website_url: 'https://adaexample.dev', link: 'https://stackoverflow.com/users/4242/ada-example', profile_image: 'https://i.sstatic.net/a.png', display_name: 'Ada Example', reputation: 15230, ...over }], has_more: false, quota_max: 300, quota_remaining: 297 });
const seAnswers = () => ({ items: [
  { owner: { user_id: 4242, display_name: 'Ada Example' }, is_accepted: true, score: 57, last_activity_date: 1714100000, creation_date: 1714000000, answer_id: 78001, question_id: 77001, content_license: 'CC BY-SA 4.0' },
  { owner: { user_id: 4242, display_name: 'Ada Example' }, is_accepted: false, score: 12, last_activity_date: 1690100000, creation_date: 1690000000, answer_id: 76002, question_id: 75002, content_license: 'CC BY-SA 4.0' },
], has_more: true, quota_max: 300, quota_remaining: 296 });
const seQuestions = () => ({ items: [
  { tags: ['sql', 'postgresql', 'indexing', 'performance'], is_answered: true, view_count: 5400, accepted_answer_id: 78001, answer_count: 3, score: 40, creation_date: 1713900000, question_id: 77001, content_license: 'CC BY-SA 4.0', link: 'https://stackoverflow.com/questions/77001/why-is-my-composite-index-not-used', title: 'Why is my composite index not used when I filter on the second column?' },
  { tags: ['typescript', 'generics'], is_answered: true, view_count: 900, answer_count: 2, score: 8, creation_date: 1689900000, question_id: 75002, content_license: 'CC BY-SA 4.0', link: 'https://stackoverflow.com/questions/75002/how-do-i-type-a-builders-chained-methods', title: 'How do I type a builder&#39;s chained methods?' },
], has_more: false, quota_max: 300, quota_remaining: 295 });

// Speaker pages, as Exa returns them (title, text, extras.links, subpages).
const PAGES = {
  'https://noti.st/adaex': { url: 'https://noti.st/adaex', title: 'Ada Example - Notist', text: 'Ada Example\nEngineer. Talks about data tools.', extras: { links: ['https://github.com/adaex', 'https://noti.st/adaex/x9y8z7/indexes-in-practice'] }, subpages: [{ url: 'https://noti.st/adaex/a1b2c3/fast-queries', title: 'Fast Queries by Ada Example', publishedDate: '2025-09-12T00:00:00.000Z', text: 'Presented at Data Days 2025.' }] },
  'https://sessionize.com/ada-example': { url: 'https://sessionize.com/ada-example', title: "Ada Example's Speaker Profile | Sessionize", text: '# Ada Example\nSoftware Engineer at Contoso\n## Sessions\n### Boring query builders\nWhy fewer features win.\n### Indexes in practice\nA field guide.\n## Events\n### Data Days 2025', extras: { links: ['https://www.linkedin.com/in/ada-example/'] } },
  'https://speakerdeck.com/ada-example-2': { url: 'https://speakerdeck.com/ada-example-2', title: 'Ada Example (@ada-example-2) on Speaker Deck', text: 'Ada Example, designer at Fabrikam', extras: { links: ['https://speakerdeck.com/ada-example-2/color-systems'] } },
};

// A fake network: routes by URL, records every call, and answers like the real APIs.
function fakeNet(over = {}) {
  const calls = [];
  const routes = {
    exa: (urls) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile() : u.startsWith('https://adaexample.dev') ? exaSite() : PAGES[u] ?? null)).filter(Boolean) }),
    exaSearch: () => ({ results: [] }),
    'github:/users/adaex': ghUser,
    'github:/users/adaex/repos': ghRepos,
    'github:/users/adaex/social_accounts': ghSocial,
    'github:/repos/contoso/sqltools': ghRepo,
    'orcid:0000-0002-1825-0097': () => orcid(),
    'openalex:0000-0002-1825-0097': alex,
    ...over,
  };
  const reply = (status, body, headers = {}) => new Response(body == null ? 'null' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url);
    const u = new URL(url);
    let key;
    if (u.host === 'api.exa.ai') {
      const body = JSON.parse(opts.body);
      return reply(200, u.pathname === '/search' ? routes.exaSearch(body) : routes.exa(body.urls, body));
    }
    if (u.host === 'dev.to') key = `dev:${u.pathname}:${u.searchParams.get('url') ?? u.searchParams.get('username')}`;
    if (u.host.endsWith('medium.com') || u.host.endsWith('substack.com')) key = `feed:${u.host}${u.pathname}`;
    if (u.host === 'api.stackexchange.com') key = `se:${u.pathname}`;
    if (u.host === 'api.github.com') key = `github:${u.pathname}`;
    if (u.host === 'pub.orcid.org') key = `orcid:${u.pathname.split('/')[2]}`;
    if (u.host === 'api.openalex.org') key = `openalex:${u.searchParams.get('filter').split(':')[1]}`;
    const route = routes[key];
    if (key?.startsWith('feed:') && typeof route === 'function') return new Response(route(), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
    if (typeof route === 'function') return reply(200, route());
    if (route && route.status) return reply(route.status, route.body ?? {}, route.headers);
    return reply(404, { message: 'Not Found' });
  };
  return { calls, fetchImpl, ctx: { ...createFetcher({ fetchImpl }), exaKey: 'test' } };
}

const lookup = (net, over = {}) => findWork({ person: ADA, goal: 'Data engineering internship', about: 'CS student', ctx: net.ctx, now: NOW, ...over });

// ---------------------------------------------------------------------------
// Links and names
// ---------------------------------------------------------------------------

test('links: accounts, repos and ORCID iDs are recognised; GitHub pages and repos are not accounts', () => {
  assert.equal(githubLogin('github.com/mattkur'), 'mattkur');
  assert.equal(githubLogin('https://github.com/adaex/'), 'adaex');
  assert.equal(githubLogin('https://github.com/adaex/querykit'), null);
  assert.equal(githubLogin('https://github.com/sponsors'), null);
  assert.equal(githubLogin('https://gist.github.com/adaex'), null);
  assert.deepEqual(githubRepo('https://github.com/Azure/data-api-builder'), { owner: 'Azure', repo: 'data-api-builder' });
  assert.equal(githubRepo('https://github.com/adaex/querykit/issues/3'), null);
  assert.equal(orcidId('https://orcid.org/0000-0002-1825-009x'), '0000-0002-1825-009X');
  assert.equal(canonicalUrl('https://www.LinkedIn.com/in/Ada-Example/?trk=x'), 'https://linkedin.com/in/ada-example');
  assert.equal(canonicalUrl('linkedin.com/in/ada-example'), canonicalUrl('https://uk.linkedin.com/in/ada-example/'));
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
});

test('links: own sites exclude platforms, aggregators and employer domains', () => {
  assert.equal(maybeOwnSite('adaexample.dev', ['Contoso']), true);
  assert.equal(maybeOwnSite('https://contoso.com/careers', ['Contoso']), false);
  assert.equal(maybeOwnSite('https://www.crunchbase.com/person/ada', []), false);
  assert.equal(maybeOwnSite('https://linktr.ee/ada', []), false);
  assert.equal(maybeOwnSite('mailto:ada@example.com', []), false);
});

test('names: a namesake with a different name is "none", nicknames and middle names still match', () => {
  assert.equal(nameVerdict('Ada Example', 'Ada Example'), 'match');
  assert.equal(nameVerdict('Matt LaFayette (Kurjanowicz)', 'Matt Kurjanowicz'), 'match');
  assert.equal(nameVerdict('Daniel Rivera', 'Dan Rivera'), 'match');
  assert.equal(nameVerdict('Ada Example', 'Ada Smith'), 'partial');
  assert.equal(nameVerdict('Ada Example', 'Bob Builder'), 'none');
  assert.equal(nameVerdict('Ada Example', 'adaex', 'adaex'), 'unknown');
  assert.equal(nameVerdict('Ada Example', ''), 'unknown');
  assert.equal(companyVerdict('@contoso', [{ company: 'Contoso Ltd' }]), 'match');
  assert.equal(companyVerdict('Fabrikam', [{ company: 'Contoso' }]), 'other');
  assert.equal(mentionsName('About Ada Example', 'Ada Example'), true);
  assert.equal(mentionsName('Our team: Ada, Bob and Example Corp', 'Ada Q. Example'), true);
  assert.equal(mentionsName('Meet the data team', 'Ada Example'), false);
});

test('contact details are scrubbed, year ranges are kept', () => {
  const out = scrubContact('Email ada@example.com, ada [at] example [dot] com, call +1 206-555-0142, visit 221 Baker Street. Worked 2019-2023.');
  assert.doesNotMatch(out, /ada@|\[at\]|555|Baker/);
  assert.match(out, /2019-2023/);
});

// ---------------------------------------------------------------------------
// The lookup
// ---------------------------------------------------------------------------

test('two hops through their own site: site, GitHub repos, ORCID role and papers, and the project they mention', async () => {
  const net = fakeNet();
  const w = await lookup(net);
  const by = (kind) => w.items.filter((it) => it.kind === kind);

  assert.equal(by('site').length, 1);
  assert.equal(by('site')[0].via, 'Linked on their LinkedIn profile');
  assert.deepEqual(by('repo').map((r) => r.title), ['adaex/querykit'], 'own, recent, not forks or archived');
  assert.equal(by('repo')[0].via, 'Linked on their website', 'profile -> site -> GitHub is two hops');
  assert.equal(by('project')[0].title, 'contoso/sqltools');
  assert.match(by('project')[0].detail, /They wrote: “Maintainer of the Contoso SQL tools”/);
  assert.deepEqual(by('role').map((r) => r.title), ['Affiliate Researcher at Example University'], 'current jobs only');
  const papers = by('paper');
  assert.equal(papers.length, 2, 'the same DOI from ORCID and OpenAlex is one item');
  assert.equal(papers[0].source, 'OpenAlex');
  assert.match(papers[0].detail, /7 citations/);
  assert.equal(papers[1].title, 'Notes on Small Data Tools');

  const gh = w.accounts.find((a) => a.kind === 'github');
  assert.equal(gh.confirmed, true, 'their GitHub links back to the LinkedIn profile');
  assert.ok(!w.accounts.some((a) => a.links), 'raw link lists are not kept');
  assert.doesNotMatch(JSON.stringify(w), /ada@example\.com|555-0142/, 'no contact details anywhere');
  assert.ok(!net.calls.some((u) => u.includes('someone-else')), 'a repo they link to is not treated as theirs');
  assert.ok(!net.calls.some((u) => u.includes('/search/')), 'never searches by name');
  assert.ok(net.calls.length <= 9, `about 5 to 8 calls, got ${net.calls.length}`);
  assert.equal(w.talking_points.length, 2, 'openers written without a model');
  assert.ok(w.themes.length >= 1);
  assert.equal(w.fetched_at, NOW.toISOString());
});

// Exa attaches accounts its index matched to the name (extras.links, and a "## GitHub" section in the
// text). Those are not links the person made, so they need independent agreement.
const indexOnly = (links, text = '# Ada Example\n\nEngineer') => ({ exa: () => ({ results: [exaProfile({ text, extras: { links } })] }) });

test('an ORCID the search index matched to the name, with nothing tying it to the profile, is dropped', async () => {
  const net = fakeNet({ ...indexOnly(['orcid.org/0000-0002-1825-0097']), 'orcid:0000-0002-1825-0097': () => ({ ...orcid(), 'activities-summary': { ...orcid()['activities-summary'], employments: {}, educations: {} }, person: { ...orcid().person, 'researcher-urls': {} } }) });
  const w = await lookup(net);
  assert.deepEqual(w.items, [], 'a namesake researcher with the same name');
  assert.match(w.skipped[0].reason, /does not link back/);
});

test('a suggested ORCID is kept when it shares a school with the profile, or links back', async () => {
  const withSchool = () => ({ ...orcid(), person: { ...orcid().person, 'researcher-urls': {} }, 'activities-summary': { ...orcid()['activities-summary'], employments: {}, educations: { 'affiliation-group': [{ summaries: [{ 'education-summary': { organization: { name: 'University of Washington' } } }] }] } } });
  const school = await lookup(fakeNet({ ...indexOnly(['orcid.org/0000-0002-1825-0097']), 'orcid:0000-0002-1825-0097': withSchool }), { person: { ...ADA, education: [{ school: 'University of Washington', degree: 'BS' }] } });
  assert.ok(school.items.some((it) => it.kind === 'paper'));
  assert.match(school.accounts[0].via, /employer or school match/);

  const back = () => ({ ...orcid(), person: { ...orcid().person, 'researcher-urls': { 'researcher-url': [{ url: { value: 'https://www.linkedin.com/in/ada-example' } }] } } });
  const linked = await lookup(fakeNet({ ...indexOnly(['orcid.org/0000-0002-1825-0097']), 'orcid:0000-0002-1825-0097': back }));
  assert.equal(linked.accounts[0].confirmed, true);
  assert.match(linked.accounts[0].via, /links back/);
});

test('a GitHub account in the page section Exa adds is only a suggestion: kept with a back-link, else dropped', async () => {
  const text = '# Ada Example\n\nEngineer\n\n## GitHub\n\n[GitHub Profile](https://github.com/adaex)\nUsername: adaex';
  const noBack = await lookup(fakeNet({ ...indexOnly([], text), 'github:/users/adaex/social_accounts': () => [], 'github:/users/adaex': () => ghUser({ company: '', blog: '' }) }));
  assert.deepEqual(noBack.items, []);
  assert.equal(noBack.skipped.length, 1);
  const back = await lookup(fakeNet({ ...indexOnly([], text), 'github:/users/adaex': () => ghUser({ company: '', blog: '' }) }));
  assert.ok(back.items.some((it) => it.title === 'adaex/querykit'));
  assert.equal(back.accounts[0].confirmed, true);
});

test('two or more of their own project links under one account make that account theirs', async () => {
  const text = '# Ada Example\n\n## Projects\n\nQuery kit [Project Link](https://github.com/adaex/querykit?trk=public_profile_project-button)\nOld thing [Project Link](https://github.com/adaex/old-thing?trk=public_profile_project-button)';
  const w = await lookup(fakeNet({ ...indexOnly([], text), 'github:/users/adaex/social_accounts': () => [] }));
  assert.match(w.accounts.find((a) => a.kind === 'github').via, /Their projects on their LinkedIn profile are on this account/);
});

// Name searches: GitHub (search/users) and ORCID (expanded-search), in the real response shapes.
const searchHits = (...users) => ({ 'github:/search/users': () => ({ total_count: users.length, incomplete_results: false, items: users.map((u) => (typeof u === 'string' ? { login: u, type: 'User', html_url: `https://github.com/${u}` } : u)) }) });
const orcidHits = (...rows) => ({ 'orcid:expanded-search': () => ({ 'expanded-result': rows.map(([id, given, family, inst]) => ({ 'orcid-id': id, 'given-names': given, 'family-names': family, 'credit-name': null, 'other-name': [], email: [], 'institution-name': inst })), 'num-found': rows.length }) });
const noLinks = { exa: () => ({ results: [exaProfile({ text: '# Ada Example\n\nSoftware Engineer at Contoso', extras: { links: [] } })] }) };
const githubUser = (login, over = {}) => ({
  [`github:/users/${login}`]: () => ghUser({ login, html_url: `https://github.com/${login}`, blog: '', ...over }),
  [`github:/users/${login}/repos`]: () => ghRepos().map((r) => ({ ...r, full_name: r.full_name.replace('adaex/', `${login}/`), html_url: r.html_url.replace('/adaex/', `/${login}/`) })),
  [`github:/users/${login}/social_accounts`]: () => [],
});

test('with nothing linked, a name search runs, and a bare name match is neither kept nor noted', async () => {
  const net = fakeNet({ ...indexOnly([]), ...searchHits('adaex'), ...githubUser('adaex', { company: '' }) });
  const w = await lookup(net);
  assert.deepEqual(w.items, []);
  assert.deepEqual(w.skipped, [], 'a namesake found by searching is not stored, not even as left out');
  assert.match(decodeURIComponent(net.calls.find((u) => u.includes('/search/users'))), /fullname:"Ada Example" type:user/);
  assert.match(decodeURIComponent(net.calls.find((u) => u.includes('/expanded-search/'))), /given-names:"Ada" AND family-name:"Example"/);
  assert.equal(net.calls.filter((u) => u.endsWith('/contents')).length, 1, 'only the profile itself was read');
});

test('searching their name on GitHub: an account that links back to them is kept, a namesake is not', async () => {
  const net = fakeNet({
    ...noLinks,
    ...searchHits('ada-other', { login: 'contoso', type: 'Organization' }, 'adaex'),
    ...githubUser('ada-other', { company: '@fabrikam' }),
  });
  const w = await lookup(net);
  const gh = w.accounts.find((a) => a.kind === 'github');
  assert.equal(gh.url, 'https://github.com/adaex');
  assert.equal(gh.via, 'Found by searching their name, and it links back to them');
  assert.equal(gh.confirmed, true);
  assert.ok(w.items.some((it) => it.kind === 'repo' && it.title === 'adaex/querykit'));
  assert.ok(!net.calls.some((u) => u.includes('/users/contoso')), 'organizations are not people');
  assert.doesNotMatch(JSON.stringify(w), /ada-other/, "the namesake's account is not kept anywhere");
});

test('searching their name on GitHub: name plus employer counts only when one result matches that way', async () => {
  const both = await lookup(fakeNet({ ...noLinks, ...searchHits('ada-one', 'ada-two'), ...githubUser('ada-one', { company: '@contoso' }), ...githubUser('ada-two', { company: '@contoso' }) }));
  assert.deepEqual(both.items, [], "two people with that name at Contoso: we can't tell which");
  assert.deepEqual(both.skipped, []);

  const one = await lookup(fakeNet({ ...noLinks, ...searchHits('ada-one', 'ada-two'), ...githubUser('ada-one', { company: '@fabrikam' }), ...githubUser('ada-two', { company: '@contoso' }) }));
  assert.deepEqual(one.accounts.map((a) => [a.url, a.via, a.confirmed]), [['https://github.com/ada-two', 'Found by searching their name; its name and an employer or school match their profile', false]]);
  assert.ok(one.items.some((it) => it.title === 'ada-two/querykit'));
});

test('a GitHub they linked is never searched for', async () => {
  const net = fakeNet({ exa: () => ({ results: [exaProfile({ text: '# Ada Example\n\nI keep my code at https://github.com/adaex', extras: { links: [] } })] }) });
  await lookup(net);
  assert.ok(!net.calls.some((u) => u.includes('/search/users')));
  assert.ok(net.calls.some((u) => u.includes('/expanded-search/')), 'they linked no ORCID, so that one is searched');
});

test('searching their name on ORCID: the one record that shares a school is kept; two such records are not', async () => {
  const OTHER = '0000-0001-5000-0007';
  const person = { ...ADA, education: [{ school: 'Example University', degree: 'MS' }] };
  const net = fakeNet({ ...noLinks, ...orcidHits(['0000-0002-1825-0097', 'Ada', 'Example', ['Example University']], [OTHER, 'Ada', 'Example', ['Fabrikam Institute of Technology']]) });
  const w = await lookup(net, { person });
  assert.equal(w.accounts.find((a) => a.kind === 'orcid')?.via, 'Found by searching their name; its name and an employer or school match their profile');
  assert.ok(w.items.some((it) => it.kind === 'paper' && it.source === 'OpenAlex'));
  assert.ok(w.items.some((it) => it.kind === 'role'));
  assert.ok(!net.calls.some((u) => u.includes(OTHER)), 'a namesake at another school is never read');

  const twins = fakeNet({ ...noLinks, ...orcidHits(['0000-0002-1825-0097', 'Ada', 'Example', ['Example University']], [OTHER, 'Ada', 'Example', ['Example University']]), [`orcid:${OTHER}`]: () => orcid() });
  const t = await lookup(twins, { person });
  assert.ok(!t.accounts.some((a) => a.kind === 'orcid'), "two records with that name and school: we can't tell which");
  assert.deepEqual(t.skipped, []);
  assert.ok(!twins.calls.some((u) => u.includes('openalex')), 'records that can only count by linking back skip OpenAlex');
});

test('searching their name on ORCID: a record with no shared school counts only if it links back', async () => {
  const back = () => ({ ...orcid(), person: { ...orcid().person, 'researcher-urls': { 'researcher-url': [{ url: { value: 'https://www.linkedin.com/in/ada-example' } }] } } });
  const w = await lookup(fakeNet({ ...noLinks, ...orcidHits(['0000-0002-1825-0097', 'Ada', 'Example', []]), 'orcid:0000-0002-1825-0097': back }));
  const rec = w.accounts.find((a) => a.kind === 'orcid');
  assert.equal(rec?.via, 'Found by searching their name, and it links back to them');
  assert.ok(w.items.filter((it) => it.kind === 'paper').every((it) => it.source === 'ORCID'));

  const none = await lookup(fakeNet({ ...noLinks, ...orcidHits(['0000-0002-1825-0097', 'Ada', 'Example', []]) }));
  assert.ok(!none.accounts.some((a) => a.kind === 'orcid'), 'its own website is not one we tied to them');
});

test('a linked account whose name contradicts the profile is dropped', async () => {
  const net = fakeNet({
    exa: () => ({ results: [exaProfile({ extras: { links: ['github.com/adaex'] }, text: 'Engineer' })] }),
    'github:/users/adaex': () => ghUser({ name: 'Bob Builder' }),
  });
  const w = await lookup(net);
  assert.deepEqual(w.items, []);
  assert.equal(w.skipped.length, 1);
  assert.match(w.skipped[0].reason, /Bob Builder/);
});

test('a partly matching name is dropped with a different employer, kept with the same one', async () => {
  const linkOnly = { exa: () => ({ results: [exaProfile({ extras: { links: ['github.com/adaex'] }, text: 'Engineer' })] }) };
  const other = await lookup(fakeNet({ ...linkOnly, 'github:/users/adaex': () => ghUser({ name: 'Ada Smith', company: '@fabrikam' }) }));
  assert.equal(other.items.length, 0);
  assert.match(other.skipped[0].reason, /employer/);
  const same = await lookup(fakeNet({ ...linkOnly, 'github:/users/adaex': () => ghUser({ name: 'Ada Smith', company: '@contoso' }) }));
  assert.equal(same.items.filter((it) => it.kind === 'repo').length, 1);
});

test("someone else's page is not followed: a site without their name is skipped with its links", async () => {
  const net = fakeNet({ exa: (urls) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile() : exaSite({ title: 'Meet the team', text: 'Our data team builds tools.' }))) }) });
  const w = await lookup(net);
  assert.ok(!w.items.some((it) => it.kind === 'site' || it.kind === 'repo' || it.kind === 'paper'));
  assert.ok(!net.calls.some((u) => u.includes('/users/adaex') || u.includes('0000-0002-1825-0097')));
});

test('at most two hops: a site their GitHub links to is not read', async () => {
  const net = fakeNet({
    exa: (urls) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile({ text: '# Ada Example\n\nI keep my code at https://github.com/adaex', extras: { links: [] } }) : null)).filter(Boolean) }),
    'github:/users/adaex': () => ghUser({ blog: 'https://another-site.example' }),
  });
  const w = await lookup(net);
  assert.ok(w.items.some((it) => it.kind === 'repo'));
  assert.equal(net.calls.filter((u) => u.endsWith('/contents')).length, 1);
});

test('"Not them" and the opt-out list are checked before anything is read', async () => {
  const blockedNet = fakeNet();
  const w = await lookup(blockedNet, { blocked: ['https://github.com/AdaEx/'] });
  assert.ok(!blockedNet.calls.some((u) => u.includes('/users/adaex')), 'the blocked account was never fetched');
  assert.ok(!w.items.some((it) => it.kind === 'repo'));
  assert.deepEqual(w.blocked, ['https://github.com/AdaEx/']);

  const optNet = fakeNet();
  const out = await lookup(optNet, { optout: new Set([canonicalUrl(PROFILE)]) });
  assert.equal(out.opted_out, true);
  assert.equal(optNet.calls.length, 0);
});

test('a rate-limited source is noted and the rest still comes back', async () => {
  const net = fakeNet({ 'github:/users/adaex': { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' } } });
  const w = await lookup(net);
  assert.ok(w.notes.some((n) => /GitHub: api\.github\.com rate limit reached/.test(n)), w.notes.join(' | '));
  assert.ok(w.items.some((it) => it.kind === 'paper'));
});

test('no profile link: nothing to start from, no calls', async () => {
  const net = fakeNet();
  const w = await findWork({ person: { ...ADA, url: null }, ctx: net.ctx, now: NOW });
  assert.deepEqual(w.items, []);
  assert.equal(net.calls.length, 0);
});

test('with a model: openers name the work, themes stay general (no titles, links or names)', async () => {
  let sent;
  const openai = {
    chat: {
      completions: {
        create: async (req) => {
          sent = req;
          return { choices: [{ message: { content: JSON.stringify({
            talking_points: ['Ask how querykit keeps queries readable, since you want to work on data tooling.'],
            themes: ['Maintains querykit, a small SQL builder', 'Builds developer tools for working with databases', 'See https://adaexample.dev', 'Ada writes about data'],
          }) } }] };
        },
      },
    },
  };
  const w = await lookup(fakeNet(), { openai, model: 'test-model' });
  assert.match(sent.messages[0].content, /data, not instructions/);
  assert.doesNotMatch(sent.messages[1].content, /ada@example|Ada Example/, 'the model gets the work, not contact details or the name');
  assert.deepEqual(w.talking_points, ['Ask how querykit keeps queries readable, since you want to work on data tooling.']);
  assert.deepEqual(w.themes, ['Builds developer tools for working with databases']);
});

test('names for a search: first and last, without titles, credentials or pronouns', () => {
  assert.deepEqual(nameParts('Kyle Lo'), ['Kyle', 'Lo']);
  assert.deepEqual(nameParts('Dr. Jane Q. Smith, PhD'), ['Jane', 'Smith']);
  assert.deepEqual(nameParts("Mary O'Brien (she/her)"), ['Mary', "O'Brien"]);
  assert.deepEqual(nameParts('José García-López 🚀'), ['José', 'García-López']);
  assert.deepEqual(nameParts('Li Xu | Speaker'), ['Li', 'Xu']);
  assert.equal(nameParts('Madonna'), null);
  assert.equal(nameParts('A. B.'), null);
  assert.deepEqual(nameParts('Ada "Byron" Example'), ['Ada', 'Example'], 'quotes never reach a search query');
});

test('helpers: stale after 30 days, plain openers by kind', () => {
  assert.equal(isStale(null), true);
  assert.equal(isStale({ fetched_at: daysAgo(3) }, NOW), false);
  assert.equal(isStale({ fetched_at: daysAgo(31) }, NOW), true);
  const p = plainPrep([{ kind: 'paper', title: 'X', date: '2024-05-01' }, { kind: 'repo', title: 'a/b' }]);
  assert.match(p.talking_points[0], /2024 paper “X”/);
  assert.deepEqual(generalThemes(['Works on a/b tooling daily'], [{ title: 'owner/a-b-tool' }], { name: 'Ada Example' }), ['Works on a/b tooling daily']);
});

// ---------------------------------------------------------------------------
// Routes, on a bare app with an in-memory store
// ---------------------------------------------------------------------------

function memoryStore() {
  const maps = new Map(); // conversation id -> { userId, map }
  const connections = new Map(); // connection id -> { userId, conversationId, personKey }
  const find = (map, key) => map.branches.flatMap((b) => b.people).find((p) => p.id === key) ?? null;
  return {
    maps,
    connections,
    async mapPerson(_db, userId, cid, key) {
      const m = maps.get(cid);
      const person = m && m.userId === userId ? find(m.map, key) : null;
      return person ? clone({ person, goal: m.map.goal, about: m.map.profile }) : null;
    },
    async connectionPerson(_db, userId, id) {
      const c = connections.get(id);
      if (!c || c.userId !== userId) return null;
      const m = maps.get(c.conversationId);
      return clone({ connection: { id, conversation_id: c.conversationId, person_key: c.personKey, name: 'Ada Example', title: 'Software Engineer', organization: 'Contoso', branch_label: 'Data engineers', talking_points_json: [] }, person: find(m.map, c.personKey), goal: m.map.goal, about: m.map.profile });
    },
  };
}

async function startApp(opts = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { user: { id: req.get('x-test-user') || 'user-a' }, db: null };
    next();
  });
  app.use('/api', workRoutes(opts));
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body, user = 'user-a') => {
    const res = await fetch(`${base}/api/${path}`, { method, headers: { 'x-test-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  return { server, call };
}

describe('Work routes (in-memory)', () => {
  const store = memoryStore();
  const cid = randomUUID();
  const connId = randomUUID();
  const net = fakeNet();
  let app;

  before(async () => {
    store.maps.set(cid, { userId: 'user-a', map: { goal: 'Data internship', profile: 'CS student', branches: [{ id: 'b1', label: 'Data engineers', people: [clone(ADA), { id: 'demo-x-1', name: 'Sample person 1', url: null }] }] } });
    store.connections.set(connId, { userId: 'user-a', conversationId: cid, personKey: PROFILE });
    app = await startApp({ store, exaKey: 'test', fetchImpl: net.fetchImpl, perDay: 2 });
  });
  after(() => app.server.close());

  test('looks up a person on your own map and returns their work', async () => {
    const r = await app.call('POST', 'people/work', { conversationId: cid, personKey: PROFILE });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(r.json.work.items.some((it) => it.title === 'adaex/querykit'));
  });

  test("someone else's map, an unknown person or a missing key is refused", async () => {
    assert.equal((await app.call('POST', 'people/work', { conversationId: cid, personKey: PROFILE }, 'user-b')).status, 404);
    assert.equal((await app.call('POST', 'people/work', { conversationId: cid, personKey: 'https://linkedin.com/in/nobody' })).status, 404);
    assert.equal((await app.call('POST', 'people/work', { conversationId: cid })).status, 400);
  });

  test('demo people get demo work, and the daily cap answers 429', async () => {
    const demo = await app.call('POST', 'people/work', { conversationId: cid, personKey: 'demo-x-1' });
    assert.equal(demo.status, 200);
    assert.equal(demo.json.work.demo, true);
    assert.equal((await app.call('POST', 'people/work', { conversationId: cid, personKey: 'demo-x-1' })).status, 429, 'perDay is 2 in this app, and refused requests do not count');
  });

  test('the Connections page reads the work saved on the map', async () => {
    store.maps.get(cid).map.branches[0].people[0].work = { items: [{ kind: 'repo', title: 'adaex/querykit' }] };
    const r = await app.call('GET', `connections/${connId}/work`);
    assert.equal(r.status, 200);
    assert.equal(r.json.work.items[0].title, 'adaex/querykit');
    assert.equal(r.json.conversationId, cid);
    assert.equal((await app.call('GET', `connections/${connId}/work`, undefined, 'user-b')).status, 404);
  });
});

test('without an Exa key, real people are not looked up', async () => {
  const store = memoryStore();
  const cid = randomUUID();
  store.maps.set(cid, { userId: 'user-a', map: { goal: '', profile: '', branches: [{ id: 'b', people: [clone(ADA)] }] } });
  const app = await startApp({ store, exaKey: null });
  try {
    const r = await app.call('POST', 'people/work', { conversationId: cid, personKey: PROFILE });
    assert.equal(r.status, 503);
    assert.match(r.json.error, /EXA_API_KEY/);
  } finally {
    app.server.close();
  }
});

// ---------------------------------------------------------------------------
// Writing, answers and talks
// ---------------------------------------------------------------------------

test('links: DEV, Medium, Substack, Stack Overflow and speaker pages are recognised', () => {
  assert.deepEqual(writingAccount('https://dev.to/AdaEx/why-query-builders-1abc'), { platform: 'devto', key: 'adaex', url: 'https://dev.to/adaex' });
  assert.equal(writingAccount('https://dev.to/t/sql'), null);
  assert.equal(writingAccount('medium.com/@adaex').feed, 'https://medium.com/feed/@adaex');
  assert.equal(writingAccount('https://adaex.medium.com/some-post-1').url, 'https://medium.com/@adaex', 'both Medium spellings are one account');
  assert.equal(writingAccount('https://medium.com/towards-data-science/a-post'), null, 'a publication is not a person');
  assert.equal(writingAccount('https://adanotes.substack.com/p/x').feed, 'https://adanotes.substack.com/feed');
  assert.equal(writingAccount('https://on.substack.com'), null);
  assert.equal(stackOverflowUser('https://stackoverflow.com/users/4242/ada-example'), '4242');
  assert.equal(stackOverflowUser('https://stackoverflow.com/questions/77001/x'), null);
  assert.equal(talkPage('https://speakerdeck.com/adaex/fast-queries').profile, 'https://speakerdeck.com/adaex');
  assert.equal(talkPage('https://noti.st/adaex/a1b2c3/fast-queries').talk, 'https://noti.st/adaex/a1b2c3/fast-queries');
  assert.equal(talkPage('https://sessionize.com/api/v2/abc/view'), null);
  assert.equal(speakerName("Ada Example's Speaker Profile | Sessionize"), 'Ada Example');
  assert.equal(speakerName('Speaker Deck'), '');
  assert.equal(maybeOwnSite('https://sessionize.com/ada-example', []), false);
});

test('feeds: RSS and Atom give titles, links, dates and authors, never post bodies', () => {
  const rss = parseFeed(mediumFeed());
  assert.equal(rss.title, 'Stories by Ada Example on Medium');
  assert.equal(rss.items.length, 1);
  assert.equal(rss.items[0].title, 'Indexes I wish I’d added sooner');
  assert.equal(rss.items[0].author, 'Ada Example');
  assert.equal(rss.items[0].date, '2024-12-12T17:11:33.000Z');
  assert.deepEqual(rss.items[0].categories, ['postgres', 'databases']);
  assert.doesNotMatch(JSON.stringify(rss), /555-0142|mailto/);
  const atom = parseFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Ada&apos;s blog</title><author><name>Ada Example</name></author><entry><title type="html">Joins &amp;amp; you</title><link rel="alternate" href="https://adaexample.dev/posts/joins"/><published>2026-02-01T10:00:00Z</published><summary>Short one.</summary><category term="sql"/></entry></feed>');
  assert.equal(atom.title, "Ada's blog");
  assert.equal(atom.author, 'Ada Example');
  assert.deepEqual(atom.items[0], { title: 'Joins & you', url: 'https://adaexample.dev/posts/joins', date: '2026-02-01T10:00:00.000Z', author: '', summary: 'Short one.', categories: ['sql'] });
});

// Their profile links DEV, Medium, Substack and Stack Overflow; their GitHub lists a Notist page;
// a search of speaker pages finds a Sessionize profile that links back, and a namesake's that doesn't.
const writerNet = (over = {}) => fakeNet({
  exa: (urls) => ({ results: urls.map((u) => (u === PROFILE
    ? exaProfile({ text: '# Ada Example\n\nSoftware Engineer at Contoso\n\n## About\n\nI write at https://dev.to/adaex and https://medium.com/@adaex, send a newsletter at https://adanotes.substack.com, and answer SQL questions: https://stackoverflow.com/users/4242/ada-example\n\nCode: https://github.com/adaex', extras: { links: [] } })
    : PAGES[u] ?? null)).filter(Boolean) }),
  exaSearch: () => ({ results: [{ url: 'https://sessionize.com/ada-example', title: "Ada Example's Speaker Profile | Sessionize" }, { url: 'https://speakerdeck.com/ada-example-2/color-systems', title: 'Color systems - Speaker Deck' }] }),
  'github:/users/adaex/social_accounts': () => [...ghSocial(), { provider: 'generic', url: 'https://noti.st/adaex' }],
  'dev:/api/users/by_username:adaex': () => devUser(),
  'dev:/api/articles:adaex': devArticles,
  'feed:medium.com/feed/@adaex': mediumFeed,
  'feed:adanotes.substack.com/feed': substackFeed,
  'se:/2.3/users/4242': () => seUser(),
  'se:/2.3/users/4242/answers': seAnswers,
  'se:/2.3/questions/77001;75002': seQuestions,
  ...over,
});

test('writing, answers and talks come only from accounts tied to them, each saying how', async () => {
  const net = writerNet();
  const w = await lookup(net);
  const of = (kind, source) => w.items.filter((it) => it.kind === kind && (!source || it.source === source));

  const dev = of('post', 'DEV');
  assert.equal(dev.length, 1, "the organization's post on DEV is not theirs");
  assert.equal(dev[0].title, 'Why query builders should be boring');
  assert.equal(dev[0].date, '2026-11-16');
  assert.match(dev[0].detail, /#sql #typescript #opensource · 79 reactions/);
  assert.equal(dev[0].via, 'Linked on their LinkedIn profile');
  assert.equal(dev[0].account, 'https://dev.to/adaex');

  const medium = of('post', 'Medium')[0];
  assert.equal(medium.url, 'https://medium.com/@adaex/indexes-i-wish-id-added-sooner-0126fa5c6ce8', 'tracking query removed');
  assert.equal(of('post', 'Substack')[0].detail, 'What I check first, and what I ignore');

  const answers = of('answer');
  assert.deepEqual(answers.map((a) => a.title), ['Why is my composite index not used when I filter on the second column?', 'How do I type a builder\'s chained methods?']);
  assert.equal(answers[0].url, 'https://stackoverflow.com/a/78001');
  assert.match(answers[0].detail, /^Score 57 · accepted · \[sql\] \[postgresql\] \[indexing\]$/);
  assert.match(w.accounts.find((a) => a.kind === 'stackoverflow').label, /15,230 reputation/);

  const talks = of('talk');
  const notist = talks.find((t) => t.source === 'Notist' && t.title === 'Fast Queries');
  assert.ok(notist, 'a talk from the Notist page their GitHub lists');
  assert.equal(notist.detail, 'Data Days 2025');
  assert.equal(notist.via, 'Linked on their GitHub');
  const sessionize = talks.filter((t) => t.source === 'Sessionize');
  assert.ok(sessionize.length >= 1, 'the Sessionize profile found by name links back to their LinkedIn');
  assert.equal(sessionize[0].via, 'Found by searching their name, and it links back to them');
  assert.ok(!net.calls.some((u) => u.includes('/search/users')), 'they linked their GitHub, so it is not searched for');
  assert.ok(!talks.some((t) => t.url.includes('ada-example-2')), 'at most two speaker pages, and the ones tied to them come first');

  assert.ok(w.items.length <= 12);
  for (const kind of ['repo', 'post', 'answer', 'talk']) assert.ok(w.items.some((it) => it.kind === kind), `keeps at least one ${kind}`);
  assert.doesNotMatch(JSON.stringify(w), /ada@example\.com|555-0142/);
});

test('a speaker page found by their name is kept only when it links back to them', async () => {
  const net = writerNet({ 'github:/users/adaex/social_accounts': ghSocial });
  const w = await lookup(net);
  const talks = w.items.filter((it) => it.kind === 'talk');
  assert.deepEqual(talks.map((t) => [t.title, t.source]), [['Boring query builders', 'Sessionize'], ['Indexes in practice', 'Sessionize']]);
  assert.doesNotMatch(JSON.stringify(w), /ada-example-2/, "the namesake's page names another employer and doesn't link to them, and isn't kept anywhere");
  assert.ok(net.calls.some((u) => u === 'https://api.exa.ai/search'));
});

test('a writing account the search index suggests needs a link back to them', async () => {
  const net = writerNet({
    exa: (urls) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile({ text: '# Ada Example\n\nCode: https://github.com/adaex', extras: { links: ['https://medium.com/@ada-example-writes', 'https://dev.to/adaex'] } }) : null)).filter(Boolean) }),
    'feed:medium.com/feed/@ada-example-writes': () => mediumFeed().replace('@adaex/indexes', '@ada-example-writes/indexes'),
  });
  const w = await lookup(net);
  assert.ok(!w.items.some((it) => it.source === 'Medium'), 'a Medium feed carries no link back to them');
  assert.ok(w.skipped.some((x) => x.url === 'https://medium.com/@ada-example-writes'));
  const dev = w.items.find((it) => it.source === 'DEV');
  assert.equal(dev?.via, 'Suggested by the search index, and it links back to them', 'DEV lists their GitHub');
});

test('two hops at most: what a GitHub found through their site lists is not read', async () => {
  const net = writerNet({
    exa: (urls) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile({ extras: { links: [] } }) : u.startsWith('https://adaexample.dev') ? exaSite() : null)).filter(Boolean) }),
    'github:/users/adaex/social_accounts': () => [{ provider: 'generic', url: 'https://dev.to/adaex' }],
  });
  const w = await lookup(net);
  assert.ok(w.items.some((it) => it.kind === 'repo'), 'GitHub, linked on their site, is read');
  assert.ok(!net.calls.some((u) => u.includes('dev.to')), 'DEV would be a third hop');
});

test('"Not them" on a writing account stops it from being read again', async () => {
  const net = writerNet();
  const w = await lookup(net, { blocked: ['https://dev.to/adaex'] });
  assert.ok(!net.calls.some((u) => u.includes('dev.to')));
  assert.ok(!w.items.some((it) => it.source === 'DEV'));
});

test('posts on their own site come from the pages Exa read under it', async () => {
  const site = exaSite({
    subpages: [
      { url: 'https://adaexample.dev/blog', title: 'Blog' },
      { url: 'https://adaexample.dev/blog/joins-in-practice', title: 'Joins in practice | Ada Example', publishedDate: '2026-06-02T00:00:00.000Z', text: 'How I think about joins. Mail ada@example.com.' },
      { url: 'https://adaexample.dev/tags/sql', title: 'Posts tagged sql' },
      { url: 'https://elsewhere.example/post', title: 'Not on their site' },
    ],
  });
  const net = fakeNet({ exa: (urls, body) => ({ results: urls.map((u) => (u === PROFILE ? exaProfile() : u.startsWith('https://adaexample.dev') ? { ...site, asked: body } : null)).filter(Boolean) }) });
  const w = await lookup(net);
  const posts = w.items.filter((it) => it.kind === 'post');
  assert.deepEqual(posts.map((p) => [p.title, p.date, p.source]), [['Joins in practice', '2026-06-02', 'Their website']]);
  assert.equal(posts[0].detail, 'How I think about joins.');
});

test('the coffee chat partner gets their work as general themes, never titles or links', async () => {
  const person = { ...clone(ADA), work: { themes: ['Builds developer tools for databases', 'Ada Example shares notes at https://adaexample.dev and adaexample.dev/blog'], items: [{ title: 'adaex/querykit' }] } };
  const map = { goal: 'Data internship', profile: '', branches: [{ id: 'b', people: [person] }] };
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, maybeSingle: async () => ({ data: { data_json: map }, error: null }) };
  const db = { from: () => chain };
  const conn = { id: randomUUID(), conversation_id: randomUUID(), person_key: PROFILE, name: 'Ada Example', title: 'Software Engineer', organization: 'Contoso', why: 'Ada Example builds data tools.', branch_label: 'Data engineers', talking_points_json: [] };
  const { setup } = practice.parseSetup({ connection_id: conn.id, goal: 'learn_role' });

  const context = await practice.mapContext(db, 'user-a', conn.conversation_id, conn.person_key);
  const scenario = practice.buildScenario(setup, conn, context, { mock: false });
  const prompt = practice.personaPrompt(scenario);
  const first = scenario.persona.first_name;
  assert.deepEqual(scenario.persona.work_themes, ['Builds developer tools for databases', `${first} shares notes at and`]);
  assert.match(prompt, /Your recent work, in general terms: Builds developer tools for databases;/);
  assert.match(prompt, /never name a repository, paper, product, project or website/);
  assert.doesNotMatch(prompt, /adaexample|querykit|Ada Example|Example/);

  // Someone whose work wasn't looked up: the prompt is as before.
  const plain = practice.personaPrompt(practice.buildScenario(setup, conn, await practice.mapContext(db, 'user-a', conn.conversation_id, 'someone-else'), { mock: false }));
  assert.doesNotMatch(plain, /recent work|never name a repository/);
});

// ---------------------------------------------------------------------------
// Against Supabase: row level security and deletion (demo mode, so no outside calls)
// ---------------------------------------------------------------------------

describe('Work API (Supabase)', { skip: configured ? false : 'SUPABASE_URL / SUPABASE_ANON_KEY not set in .env' }, () => {
  let server;
  const created = [];
  const email = makeEmail('work');
  let a;
  let b;
  let cid;
  let personKey;

  before(async () => {
    ({ child: server } = await startServer());
    ({ client: a } = await signUpAs(email('a'), created, 'Test a'));
    ({ client: b } = await signUpAs(email('b'), created, 'Test b'));
    const turn = await a.post('/api/network', { message: 'Data engineering internship' });
    assert.equal(turn.status, 200, turn.text);
    cid = turn.json.conversationId;
    const map = (await a.get(`/api/conversations/${cid}`)).json.map;
    const people = (await a.post('/api/people', { branch: map.branches[0], count: 2 })).json.people;
    map.branches[0].people = people;
    personKey = people[0].id;
    assert.equal((await a.put(`/api/conversations/${cid}/map`, { map })).status, 200);
  });

  after(async () => {
    await deleteAccounts(created);
    server?.kill();
  });

  test("a lookup reads the person from your saved map; another user can't look them up", async () => {
    const mine = await a.post('/api/people/work', { conversationId: cid, personKey });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.json.work.demo, true);
    assert.equal((await b.post('/api/people/work', { conversationId: cid, personKey })).status, 404);
  });

  test('saved work shows on the connection, respects "Not them", and goes with the chat', async () => {
    const map = (await a.get(`/api/conversations/${cid}`)).json.map;
    const work = (await a.post('/api/people/work', { conversationId: cid, personKey })).json.work;
    map.branches[0].people[0].work = { ...work, blocked: ['demo'] };
    assert.equal((await a.put(`/api/conversations/${cid}/map`, { map })).status, 200);
    const after = await a.post('/api/people/work', { conversationId: cid, personKey });
    assert.deepEqual(after.json.work.items, [], 'the server reads "Not them" from the saved map');

    const conn = await a.patch(`/api/conversations/${cid}/connections`, { personKey, status: 'saved' });
    assert.equal(conn.status, 200, conn.text);
    const shown = await a.get(`/api/connections/${conn.json.id}/work`);
    assert.equal(shown.status, 200, shown.text);
    assert.equal(shown.json.work.items.length, 2);
    assert.equal((await b.get(`/api/connections/${conn.json.id}/work`)).status, 404, 'row level security');

    assert.equal((await a.req('DELETE', `/api/conversations/${cid}`)).status, 200);
    assert.equal((await a.get(`/api/connections/${conn.json.id}/work`)).status, 404, 'deleted with the chat');
  });
});

test('a bare "Project Link" line takes the description above it', async () => {
  const text = '# Ada Example\n\n## Projects\n\n### Query kit\nJan 2020 - Present\nA tiny query builder for SQL databases\n[Project Link](https://github.com/adaex/querykit?trk=public_profile_project-button)';
  const w = await lookup(fakeNet({ exa: () => ({ results: [exaProfile({ text, extras: { links: [] } })] }) }));
  assert.match(w.items.find((it) => it.kind === 'project').detail, /They wrote: “A tiny query builder for SQL databases”/);
});
