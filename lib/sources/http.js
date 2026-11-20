// Shared HTTP plumbing for the work lookups: timeouts, a plain User-Agent, a short in-memory
// cache, at most a few calls per host at once, and cooldowns when an API says "slow down".
// Every source calls its API through fetchJson, so none of them can hammer an API that is
// already rate limiting us. Ported from TempNetsearch PR #4 (sources/http.js), trimmed.

const USER_AGENT = 'NetPrep/0.3 (networking prototype; reads public professional records through official APIs)';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const PER_HOST = 3;
const COOLDOWN_MS = 60 * 1000;

export class SourceError extends Error {
  constructor(message, { status } = {}) {
    super(message);
    this.status = status;
  }
}

export function createFetcher({ fetchImpl = (...args) => globalThis.fetch(...args), clock = () => Date.now() } = {}) {
  const cache = new Map(); // key -> { at, data }
  const cooldowns = new Map(); // bucket -> until (ms)
  const queues = new Map(); // host -> { active, waiting }

  async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000 } = {}) {
    const host = new URL(url).host;
    const bucket = bucketOf(url);
    const key = `${method} ${url} ${body ?? ''}`;
    const hit = cache.get(key);
    if (hit && clock() - hit.at < CACHE_TTL_MS) return hit.data;

    if ((cooldowns.get(bucket) ?? 0) > clock()) throw new SourceError(`${host} asked us to slow down. Try again in a minute.`, { status: 429 });

    const res = await withSlot(host, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetchImpl(url, { method, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, body, signal: controller.signal });
      } catch (err) {
        const reason = err?.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : err?.cause?.code || err?.message || 'network error';
        throw new SourceError(`Could not reach ${host} (${reason}).`);
      } finally {
        clearTimeout(timer);
      }
    });

    noteRateLimit(bucket, res);
    if (res.status === 404) return null; // "no such user / record" is an answer, not a failure
    if (!res.ok) {
      const limited = res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
      if (limited && (cooldowns.get(bucket) ?? 0) <= clock()) cooldowns.set(bucket, clock() + COOLDOWN_MS);
      throw new SourceError(limited ? `${host} rate limit reached.` : `${host} answered ${res.status}.`, { status: res.status });
    }
    const data = await res.json();
    cache.set(key, { at: clock(), data });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return data;
  }

  // Standard rate-limit headers: when the budget is spent, cool down until the reset time.
  function noteRateLimit(bucket, res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const retryAfter = Number(res.headers.get('retry-after'));
    if (retryAfter > 0 && (res.status === 429 || res.status === 403)) cooldowns.set(bucket, clock() + retryAfter * 1000);
    else if (remaining === '0' && reset > 0) cooldowns.set(bucket, Math.max(reset > 1e9 ? reset * 1000 : clock() + reset * 1000, clock() + 1000));
  }

  async function withSlot(host, fn) {
    if (!queues.has(host)) queues.set(host, { active: 0, waiting: [] });
    const q = queues.get(host);
    if (q.active >= PER_HOST) await new Promise((resolve) => q.waiting.push(resolve));
    q.active += 1;
    try {
      return await fn();
    } finally {
      q.active -= 1;
      q.waiting.shift()?.();
    }
  }

  return { fetchJson };
}

// GitHub counts searches and other calls separately.
function bucketOf(url) {
  const u = new URL(url);
  return u.host === 'api.github.com' ? `${u.host}:${u.pathname.startsWith('/search/') ? 'search' : 'core'}` : u.host;
}

// Settles every promise; a failure becomes null and its message is kept in notes.
export async function settle(promise, notes, label) {
  try {
    return await promise;
  } catch (err) {
    notes.push(`${label}: ${err?.message ?? 'failed'}`);
    return null;
  }
}
