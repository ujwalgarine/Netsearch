// GitHub REST, public data only: a user's profile, their own repos by recent activity, and the
// links they listed (blog and /social_accounts). The profile's email field is never read.
// Without GITHUB_TOKEN GitHub allows 60 calls an hour per IP; a token with no scopes allows 5,000.

const API = 'https://api.github.com';

function headers(ctx) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (ctx.githubToken) h.Authorization = `Bearer ${ctx.githubToken}`;
  return h;
}

// Three calls: the profile, recent repos, and the links they listed. null when there is no such user.
export async function githubAccount(ctx, login) {
  const get = (p) => ctx.fetchJson(`${API}${p}`, { headers: headers(ctx) });
  const who = encodeURIComponent(login);
  const user = await get(`/users/${who}`);
  if (!user || user.type !== 'User') return null; // organizations are not a person
  const [repos, socials] = await Promise.all([
    get(`/users/${who}/repos?sort=pushed&per_page=12&type=owner`).catch(() => []),
    get(`/users/${who}/social_accounts`).catch(() => []),
  ]);
  return {
    login: user.login,
    url: user.html_url || `https://github.com/${user.login}`,
    name: user.name || '',
    company: user.company || '',
    bio: user.bio || '',
    links: [user.blog, ...(Array.isArray(socials) ? socials.map((s) => s?.url) : [])].filter(Boolean),
    repos: (Array.isArray(repos) ? repos : []).filter((r) => r && !r.fork && !r.archived && !r.private).map(repoFacts),
  };
}

// One call: a repo the person mentioned on their own profile (it may belong to their employer).
export async function githubRepoFacts(ctx, owner, repo) {
  const r = await ctx.fetchJson(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: headers(ctx) });
  return r && !r.private ? repoFacts(r) : null;
}

function repoFacts(r) {
  return {
    name: r.full_name || r.name,
    url: r.html_url,
    description: r.description || '',
    language: r.language || '',
    stars: r.stargazers_count || 0,
    pushed: r.pushed_at || r.updated_at || null,
    topics: Array.isArray(r.topics) ? r.topics.slice(0, 5) : [],
  };
}

// Users whose GitHub name is this full name, best match first. One search call (GitHub allows 10
// searches a minute without a token, 30 with one). `total` says how common the name is there.
export async function githubSearchUsers(ctx, first, last) {
  const q = `fullname:"${first} ${last}" type:user`;
  const data = await ctx.fetchJson(`${API}/search/users?q=${encodeURIComponent(q)}&per_page=5`, { headers: headers(ctx) });
  return { total: data?.total_count ?? 0, logins: (data?.items ?? []).filter((u) => u?.type === 'User' && u.login).map((u) => u.login) };
}
