// Accounts: Supabase Auth does the password hashing and session storage; this server is the only
// thing that talks to it. The browser holds two HttpOnly cookies:
//   np_session  the Supabase access token (a short-lived JWT, refreshed here when it expires)
//   np_refresh  the Supabase refresh token
// plus np_exp, the fixed 30-day end of the session. Each request resolves the cookies to a user
// and a per-request Supabase client that acts as that user, so row level security applies.

import express from 'express';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

export const SESSION_COOKIE = 'np_session';
const REFRESH_COOKIE = 'np_refresh';
const EXPIRY_COOKIE = 'np_exp';
const SESSION_DAYS = 30;
const USER_CACHE_MS = 30_000; // skip re-verifying the same access token for this long

const GENERIC_LOGIN_ERROR = 'Email or password is incorrect.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAuth({ supabaseUrl, supabaseKey, production }) {
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  // A fresh client per auth call, so no session state is ever shared between requests.
  const authClient = () => createClient(supabaseUrl, supabaseKey, clientOptions);
  const userClient = (accessToken) =>
    createClient(supabaseUrl, supabaseKey, { ...clientOptions, global: { headers: { Authorization: `Bearer ${accessToken}` } } });

  const cache = new Map(); // access token -> { user, until }

  const cookieBase = { httpOnly: true, sameSite: 'lax', path: '/', secure: production };

  function setSessionCookies(res, session, expiresAt) {
    const maxAge = Math.max(0, expiresAt - Date.now());
    res.cookie(SESSION_COOKIE, session.access_token, { ...cookieBase, maxAge });
    res.cookie(REFRESH_COOKIE, session.refresh_token, { ...cookieBase, maxAge });
    res.cookie(EXPIRY_COOKIE, String(expiresAt), { ...cookieBase, maxAge });
  }

  function clearSessionCookies(res) {
    for (const name of [SESSION_COOKIE, REFRESH_COOKIE, EXPIRY_COOKIE]) res.clearCookie(name, cookieBase);
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.user_metadata?.name || '' });

  // Revoke a Supabase session (best effort; the cookies are cleared regardless).
  async function revoke(accessToken) {
    if (!accessToken) return;
    cache.delete(accessToken);
    try {
      await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` },
      });
    } catch {}
  }

  // Cookies -> { user, token, db } or null. Refreshes an expired access token and rewrites the cookies.
  async function resolveSession(req, res) {
    const access = req.cookies?.[SESSION_COOKIE];
    const refresh = req.cookies?.[REFRESH_COOKIE];
    const expiresAt = Number(req.cookies?.[EXPIRY_COOKIE]) || 0;
    if (!access && !refresh) return null;
    if (expiresAt && expiresAt < Date.now()) {
      clearSessionCookies(res);
      return null;
    }

    if (access) {
      const hit = cache.get(access);
      if (hit && hit.until > Date.now()) return { user: hit.user, token: access, db: userClient(access) };
      if (!jwtExpired(access)) {
        const { data } = await authClient().auth.getUser(access);
        if (data?.user) {
          remember(access, data.user);
          return { user: data.user, token: access, db: userClient(access) };
        }
      }
    }

    if (refresh) {
      const { data } = await authClient().auth.refreshSession({ refresh_token: refresh });
      if (data?.session?.user) {
        setSessionCookies(res, data.session, expiresAt || Date.now() + SESSION_DAYS * 864e5);
        remember(data.session.access_token, data.session.user);
        return { user: data.session.user, token: data.session.access_token, db: userClient(data.session.access_token) };
      }
    }

    clearSessionCookies(res);
    return null;
  }

  function remember(token, user) {
    if (cache.size > 1000) cache.clear();
    cache.set(token, { user, until: Date.now() + USER_CACHE_MS });
  }

  // Attach req.auth when signed in. Never throws: a Supabase outage reads as signed out.
  async function attach(req, res, next) {
    try {
      req.auth = await resolveSession(req, res);
    } catch (err) {
      console.error('[auth]', err?.message ?? err);
      req.auth = null;
    }
    next();
  }

  function requireApiUser(req, res, next) {
    if (!req.auth) return res.status(401).json({ error: 'Sign in to continue.' });
    next();
  }

  function requirePageUser(req, res, next) {
    if (req.auth) return next();
    res.redirect(`/login?next=${encodeURIComponent(safeNext(req.originalUrl))}`);
  }

  // Signed-in users skip the login and signup pages.
  function redirectIfSignedIn(req, res, next) {
    if (req.auth) return res.redirect(safeNext(req.query.next));
    next();
  }

  // ---- rate limits ----
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true, // only failed attempts count
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    handler: (_req, res) => res.status(429).json({ error: 'Too many sign-in attempts. Wait 15 minutes and try again.' }),
  });
  const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many new accounts from this network. Try again in an hour.' }),
  });

  // ---- routes ----
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  router.post('/signup', signupLimiter, wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 100);
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const fields = {};
    if (!name) fields.name = 'Enter your name.';
    if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
    if (password.length < 10) fields.password = 'Use at least 10 characters.';
    if (password.length > 72) fields.password = 'Use 72 characters or fewer.';
    if (Object.keys(fields).length) return res.status(400).json({ error: 'Check the highlighted fields.', fields });

    const { data, error } = await authClient().auth.signUp({ email, password, options: { data: { name } } });
    if (error) {
      if (error.code === 'user_already_exists' || /already registered/i.test(error.message)) {
        return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.', code: 'exists' });
      }
      if (error.code === 'weak_password') {
        return res.status(400).json({ error: 'Choose a stronger password.', fields: { password: error.message } });
      }
      if (error.status === 429) return res.status(429).json({ error: 'Too many sign-ups right now. Try again in a few minutes.' });
      console.error('[auth] signup', error.status, error.code, error.message);
      return res.status(502).json({ error: "Couldn't create your account. Try again." });
    }
    if (!data.session) {
      // Supabase hid the result because "Confirm email" is on (it also does this for existing emails).
      return res.status(503).json({
        error: 'Accounts need "Confirm email" turned off in Supabase (Authentication → Sign In / Providers → Email).',
      });
    }

    await revoke(req.cookies?.[SESSION_COOKIE]); // signing up replaces any existing session
    setSessionCookies(res, data.session, Date.now() + SESSION_DAYS * 864e5);
    remember(data.session.access_token, data.session.user);
    await logEvent(userClient(data.session.access_token), data.session.user.id, 'signup');
    res.status(201).json({ user: publicUser(data.session.user), redirect: safeNext(req.body?.next) });
  }));

  router.post('/login', loginLimiter, wrap(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) return res.status(401).json({ error: GENERIC_LOGIN_ERROR });

    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      if (error?.status === 429) return res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' });
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    await revoke(req.cookies?.[SESSION_COOKIE]); // a new login rotates the session
    setSessionCookies(res, data.session, Date.now() + SESSION_DAYS * 864e5);
    remember(data.session.access_token, data.session.user);
    res.json({ user: publicUser(data.session.user), redirect: safeNext(req.body?.next) });
  }));

  router.post('/logout', wrap(async (req, res) => {
    await revoke(req.auth?.token ?? req.cookies?.[SESSION_COOKIE]);
    clearSessionCookies(res);
    res.json({ ok: true });
  }));

  router.get('/me', (req, res) => {
    if (!req.auth) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: publicUser(req.auth.user) });
  });

  // For the landing page: always 200, so signed-out visitors don't see a failed request.
  router.get('/session', (req, res) => {
    res.json({ signedIn: Boolean(req.auth) });
  });

  // DELETE /api/account
  async function deleteAccount(req, res) {
    const password = String(req.body?.password ?? '');
    const { data, error } = await authClient().auth.signInWithPassword({ email: req.auth.user.email, password });
    if (error || !data.session) return res.status(401).json({ error: 'Password is incorrect.', fields: { password: 'Password is incorrect.' } });
    await revoke(data.session.access_token); // the check above opened a second session; close it

    const { error: rpcError } = await req.auth.db.rpc('delete_my_account');
    if (rpcError) {
      console.error('[auth] delete account', rpcError.code, rpcError.message);
      return res.status(500).json({ error: "Couldn't delete your account. Try again." });
    }
    cache.delete(req.auth.token);
    clearSessionCookies(res);
    res.json({ ok: true });
  }

  return { attach, requireApiUser, requirePageUser, redirectIfSignedIn, router, deleteAccount };
}

export async function logEvent(db, userId, type, refId = null) {
  const { error } = await db.from('events').insert({ user_id: userId, type, ref_id: refId == null ? null : String(refId) });
  if (error) console.error('[events]', type, error.message);
}

// Only same-site relative paths: "/app/c/123" yes; "//evil.com", "https://...", "/\evil" no.
export function safeNext(next) {
  const s = typeof next === 'string' ? next : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || /[\r\n]/.test(s)) return '/app';
  try {
    const u = new URL(s, 'http://local');
    if (u.host !== 'local') return '/app';
    return u.pathname + u.search + u.hash;
  } catch {
    return '/app';
  }
}

function jwtExpired(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return !payload.exp || payload.exp * 1000 < Date.now() + 5000;
  } catch {
    return true;
  }
}

// CSRF: any state-changing request must come from a page on this same host, or from one of
// `trusted` (full origins such as "https://my-app.example.com"). Behind a forwarding proxy like
// GitHub Codespaces, the browser's origin differs from the Host the server sees, so it is listed there.
export function sameOriginOnly(trusted = []) {
  const allowed = new Set(trusted.map((o) => o.replace(/\/+$/, '').toLowerCase()));
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const origin = req.get('origin');
    // GitHub Codespaces rewrites its own forwarded origin to http://localhost:<port> (matching Host)
    // and moves the public address to X-Forwarded-Host; other sites' origins pass through untouched.
    const hosts = [req.get('host'), req.get('x-forwarded-host')?.split(',')[0].trim()].filter(Boolean);
    let ok = false;
    try {
      ok = Boolean(origin && (allowed.has(origin.toLowerCase()) || hosts.includes(new URL(origin).host)));
    } catch {}
    if (!ok) return res.status(403).json({ error: 'Request blocked: it did not come from this site.' });
    next();
  };
}
