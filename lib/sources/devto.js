// DEV Community (dev.to), public Forem API, no key: a writer's profile (with the GitHub, site and X
// links they listed) and their recent published articles. Two calls per person.

const API = 'https://dev.to/api';

export async function devtoWriter(ctx, username) {
  const who = encodeURIComponent(username);
  const user = await ctx.fetchJson(`${API}/users/by_username?url=${who}`);
  if (!user?.username) return null;
  const articles = await ctx.fetchJson(`${API}/articles?username=${who}&per_page=8`).catch(() => []);
  const mine = (Array.isArray(articles) ? articles : []).filter((a) => a?.type_of === 'article' && String(a.user?.username ?? '').toLowerCase() === user.username.toLowerCase());
  return {
    url: `https://dev.to/${user.username.toLowerCase()}`,
    handle: user.username,
    name: user.name || '',
    bio: user.summary || '',
    links: [
      user.github_username && `https://github.com/${user.github_username}`,
      user.website_url,
      user.twitter_username && `https://x.com/${user.twitter_username}`,
    ].filter(Boolean),
    posts: mine.map((a) => ({
      title: String(a.title ?? ''),
      url: a.url,
      date: a.published_at || a.published_timestamp || null,
      summary: String(a.description ?? ''),
      tags: Array.isArray(a.tag_list) ? a.tag_list : String(a.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      reactions: a.public_reactions_count || a.positive_reactions_count || 0,
    })).filter((p) => p.title && p.url),
  };
}
