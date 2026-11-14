// Shared test helpers: a server on a random port (demo mode) and a cookie-keeping client.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = dotenv.config({ path: path.join(root, '.env') }).parsed ?? {};
const SUPABASE_URL = process.env.SUPABASE_URL || fileEnv.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || fileEnv.SUPABASE_ANON_KEY;
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const PASSWORD = 'correct horse battery';

let base = '';
export const setBase = (b) => { base = b; };

export function makeEmail(prefix) {
  const runId = Math.random().toString(36).slice(2, 8);
  return (who) => `netprep-test-${prefix}-${runId}-${who}@example.com`;
}

// A tiny browser stand-in: keeps cookies and sends this site's Origin on writes.
export class Client {
  constructor() {
    this.jar = new Map();
  }

  async req(method, url, body, { origin = base } = {}) {
    const headers = {};
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const setCookies = res.headers.getSetCookie();
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(sc)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers, setCookies };
  }

  get = (url, opts) => this.req('GET', url, undefined, opts);
  post = (url, body, opts) => this.req('POST', url, body ?? {}, opts);
  patch = (url, body, opts) => this.req('PATCH', url, body, opts);
  put = (url, body, opts) => this.req('PUT', url, body, opts);
  del = (url, body, opts) => this.req('DELETE', url, body, opts);

  // Straight to the database as this user (row level security applies), bypassing the API.
  db() {
    const token = decodeURIComponent(this.jar.get('np_session') ?? '');
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
}

export async function signUp(email, created, name = 'Test user') {
  const c = new Client();
  const res = await c.post('/api/auth/signup', { name, email, password: PASSWORD });
  if (res.status === 503) throw new Error(`Signup unavailable: ${res.json?.error}`);
  assert.equal(res.status, 201, `signup failed: ${res.text}`);
  c.password = PASSWORD;
  created?.push(c);
  return { client: c, res };
}

export async function deleteAccounts(clients) {
  for (const c of clients) {
    if (c.jar.size) await c.del('/api/account', { password: c.password }).catch(() => {});
  }
}

export function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: '0', OPENAI_API_KEY: '', EXA_API_KEY: '', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (d) => {
      out += d;
      const m = out.match(/running at http:\/\/localhost:(\d+)/);
      if (m) {
        child.stdout.off('data', onData);
        setBase(`http://localhost:${m[1]}`);
        resolve({ child, base: `http://localhost:${m[1]}` });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => reject(new Error(`server exited (${code}):\n${out}`)));
    setTimeout(() => reject(new Error(`server didn't start:\n${out}`)), 10_000);
  });
}
