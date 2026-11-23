// Stack Overflow, official Stack Exchange API: a user's profile (with the website they listed) and
// their highest-voted answers with the questions' titles. Three calls per person. 300 calls a day
// per IP without a key; STACKEXCHANGE_KEY (free) raises that to 10,000.

import { decodeEntities } from './links.js';

const API = 'https://api.stackexchange.com/2.3';

export async function stackAnswers(ctx, id) {
  const get = (p) => ctx.fetchJson(`${API}${p}${p.includes('?') ? '&' : '?'}site=stackoverflow${ctx.stackKey ? `&key=${encodeURIComponent(ctx.stackKey)}` : ''}`);
  const users = await get(`/users/${encodeURIComponent(id)}`);
  const user = users?.items?.[0];
  if (!user?.user_id || user.user_type === 'does_not_exist') return null;
  const answers = users.backoff ? [] : ((await get(`/users/${user.user_id}/answers?order=desc&sort=votes&pagesize=4`).catch(() => null))?.items ?? []);
  const qids = [...new Set(answers.map((a) => a.question_id).filter(Boolean))];
  const questions = qids.length ? ((await get(`/questions/${qids.join(';')}?pagesize=${qids.length}`).catch(() => null))?.items ?? []) : [];
  return {
    url: `https://stackoverflow.com/users/${user.user_id}`,
    name: decodeEntities(user.display_name),
    reputation: user.reputation || 0,
    links: [user.website_url].filter(Boolean),
    answers: answers
      .map((a) => {
        const q = questions.find((x) => x.question_id === a.question_id);
        return q && {
          title: decodeEntities(q.title),
          url: `https://stackoverflow.com/a/${a.answer_id}`,
          date: a.creation_date ? new Date(a.creation_date * 1000).toISOString() : null,
          score: a.score || 0,
          accepted: Boolean(a.is_accepted),
          tags: (q.tags ?? []).slice(0, 3),
        };
      })
      .filter(Boolean),
  };
}
