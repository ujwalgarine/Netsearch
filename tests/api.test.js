// API tests: node:test + global fetch against a real server started on a random port.
// The server runs in demo mode (no OpenAI or Exa calls) against the Supabase project in .env.
// Each run creates throwaway users (netprep-test-…@example.com) and deletes them at the end.
//
// Needs: SUPABASE_URL and SUPABASE_ANON_KEY in .env, supabase/schema.sql applied, and
// "Confirm email" turned off in Supabase. Run with: npm test

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, configured, makeEmail, signUp as signUpAs, deleteAccounts, startServer, PASSWORD } from './helpers.js';

let server;
let base;
const created = []; // clients whose accounts still need deleting
const email = makeEmail('api');
const signUp = (who, name = `Test ${who}`) => signUpAs(email(who), created, name);

describe('NetPrep API', { skip: configured ? false : 'SUPABASE_URL / SUPABASE_ANON_KEY not set in .env' }, () => {
  before(async () => {
    ({ child: server, base } = await startServer());
  });

  after(async () => {
    await deleteAccounts(created);
    server?.kill();
  });

  test('sign up -> /api/auth/me returns the user', async () => {
    const { client } = await signUp('a', 'Ada Lovelace');
    const me = await client.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.email, email('a'));
    assert.equal(me.json.user.name, 'Ada Lovelace');
  });

  test('the session cookie is HttpOnly and SameSite=Lax', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/login', { email: email('a'), password: PASSWORD });
    assert.equal(res.status, 200, res.text);
    const cookie = res.setCookies.find((s) => s.startsWith('np_session='));
    assert.ok(cookie, 'np_session cookie set');
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*SameSite=Lax/i);
    assert.match(cookie, /;\s*Path=\//i);
    await c.post('/api/auth/logout');
  });

  test('the password is never returned, and Supabase stores only a hash', { todo: 'the $2 bcrypt prefix lives in auth.users, which the public key cannot read; check it in the Supabase dashboard' }, async () => {
    const c = new Client();
    const login = await c.post('/api/auth/login', { email: email('a'), password: PASSWORD });
    const me = await c.get('/api/auth/me');
    for (const r of [login, me]) assert.ok(!r.text.includes(PASSWORD), 'password not echoed');
    await c.post('/api/auth/logout');
  });

  test('signing up with an existing email says so', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/signup', { name: 'Again', email: email('a'), password: PASSWORD });
    assert.equal(res.status, 409);
    assert.equal(res.json.error, 'An account with this email already exists. Sign in instead.');
  });

  test('signup validates the password length', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/signup', { name: 'Short', email: email('short'), password: 'tooshort' });
    assert.equal(res.status, 400);
    assert.ok(res.json.fields.password);
  });

  test('logout -> /api/auth/me returns 401', async () => {
    const c = new Client();
    await c.post('/api/auth/login', { email: email('a'), password: PASSWORD });
    assert.equal((await c.get('/api/auth/me')).status, 200);
    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  test('a wrong password gets the generic error', async () => {
    const c = new Client();
    const wrong = await c.post('/api/auth/login', { email: email('a'), password: 'not the password' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error, 'Email or password is incorrect.');
    const unknown = await c.post('/api/auth/login', { email: email('nobody'), password: 'whatever123' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error, 'Email or password is incorrect.');
  });

  test('the 6th failed login in 15 minutes returns 429', async () => {
    const c = new Client();
    const target = email('limited');
    for (let i = 1; i <= 5; i++) {
      const res = await c.post('/api/auth/login', { email: target, password: `wrong-${i}-password` });
      assert.equal(res.status, 401, `attempt ${i}`);
    }
    const sixth = await c.post('/api/auth/login', { email: target, password: 'wrong-6-password' });
    assert.equal(sixth.status, 429);
    assert.match(sixth.json.error, /Too many/);
  });

  test('a POST with a foreign Origin is rejected', async () => {
    const c = new Client();
    const res = await c.post('/api/auth/login', { email: email('a'), password: PASSWORD }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    const none = await c.post('/api/auth/login', { email: email('a'), password: PASSWORD }, { origin: null });
    assert.equal(none.status, 403);
    assert.equal(c.jar.size, 0, 'no session was created');
  });

  test('signed out: /api/* returns 401 and /app redirects to /login?next=/app', async () => {
    const c = new Client();
    assert.equal((await c.get('/api/conversations')).status, 401);
    const page = await c.get('/app');
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login?next=%2Fapp');
    const deep = await c.get('/app/chats');
    assert.equal(deep.headers.get('location'), '/login?next=%2Fapp%2Fchats');
  });

  test('signed in: /login redirects to the app, and only to a same-site next', async () => {
    const c = new Client();
    await c.post('/api/auth/login', { email: email('a'), password: PASSWORD });
    assert.equal((await c.get('/login')).headers.get('location'), '/app');
    assert.equal((await c.get('/login?next=%2Fapp%2Fchats')).headers.get('location'), '/app/chats');
    assert.equal((await c.get('/signup?next=%2F%2Fevil.example')).headers.get('location'), '/app');
    const login = await c.post('/api/auth/login', { email: email('a'), password: PASSWORD, next: 'https://evil.example/x' });
    assert.equal(login.json.redirect, '/app');
    await c.post('/api/auth/logout');
  });

  describe('conversations', () => {
    let a;
    let b;
    let convoId;

    before(async () => {
      a = new Client();
      const login = await a.post('/api/auth/login', { email: email('a'), password: PASSWORD });
      assert.equal(login.status, 200, login.text);
      a.password = PASSWORD;
      created.push(a);
      ({ client: b } = await signUp('b'));
    });

    test('a chat turn creates a conversation with messages and a map', async () => {
      const res = await a.post('/api/network', { message: 'I want a PM internship at Microsoft' });
      assert.equal(res.status, 200, res.text);
      assert.ok(res.json.conversationId);
      assert.ok(res.json.reply);
      assert.ok(res.json.goal);
      assert.ok(res.json.branches.length >= 3);
      assert.ok(res.json.branches.every((x) => x.id), 'new branches get ids');
      convoId = res.json.conversationId;

      const list = await a.get('/api/conversations');
      assert.equal(list.status, 200);
      const row = list.json.conversations.find((c) => c.id === convoId);
      assert.ok(row);
      assert.equal(row.title, res.json.goal, 'title defaults to the goal');
      assert.equal(row.connection_count, 0);
    });

    test('a follow-up turn builds on the same conversation', async () => {
      const res = await a.post('/api/network', { conversationId: convoId, message: 'I study Informatics at UW' });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.json.conversationId, convoId);
      const convo = await a.get(`/api/conversations/${convoId}`);
      assert.equal(convo.json.messages.length, 4);
      assert.deepEqual(convo.json.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
      assert.equal(convo.json.version, 2);
    });

    test('saving the map stores its people as connections; "Save connection" sets saved', async () => {
      const convo = await a.get(`/api/conversations/${convoId}`);
      const map = convo.json.map;
      map.branches[0].people = [
        { id: 'https://example.com/in/jane', name: 'Jane Doe', headline: 'Product Manager at Microsoft', why: 'UW alum', talking_points: ['Ask about PM interviews'], url: 'https://example.com/in/jane' },
      ];
      const put = await a.put(`/api/conversations/${convoId}/map`, { map });
      assert.equal(put.status, 200, put.text);

      const list = await a.get('/api/conversations');
      assert.equal(list.json.conversations.find((c) => c.id === convoId).connection_count, 1);

      const saved = await a.patch(`/api/conversations/${convoId}/connections`, { personKey: 'https://example.com/in/jane', status: 'saved' });
      assert.equal(saved.status, 200, saved.text);
      assert.equal(saved.json.status, 'saved');

      const reopened = await a.get(`/api/conversations/${convoId}`);
      assert.equal(reopened.json.map.branches[0].people[0].name, 'Jane Doe');
      assert.equal(reopened.json.statuses['https://example.com/in/jane'], 'saved');
    });

    test('rename a conversation', async () => {
      const res = await a.patch(`/api/conversations/${convoId}`, { title: 'Microsoft PM search' });
      assert.equal(res.status, 200);
      assert.equal(res.json.title, 'Microsoft PM search');
    });

    test("user B gets 404 on user A's conversation", async () => {
      assert.equal((await b.get(`/api/conversations/${convoId}`)).status, 404);
      assert.equal((await b.patch(`/api/conversations/${convoId}`, { title: 'mine now' })).status, 404);
      assert.equal((await b.put(`/api/conversations/${convoId}/map`, { map: { goal: 'x', branches: [] } })).status, 404);
      assert.equal((await b.post('/api/network', { conversationId: convoId, message: 'hi' })).status, 404);
      assert.equal((await b.patch(`/api/conversations/${convoId}/connections`, { personKey: 'https://example.com/in/jane', status: 'met' })).status, 404);
      assert.equal((await b.del(`/api/conversations/${convoId}`)).status, 404);
      assert.equal((await b.get('/api/conversations')).json.conversations.length, 0);
      // ...and A's conversation is untouched.
      const own = await a.get(`/api/conversations/${convoId}`);
      assert.equal(own.status, 200);
      assert.equal(own.json.title, 'Microsoft PM search');
    });

    test('delete a conversation', async () => {
      const extra = await a.post('/api/network', { message: 'Climate tech in Seattle' });
      const id = extra.json.conversationId;
      assert.equal((await a.del(`/api/conversations/${id}`)).status, 200);
      assert.equal((await a.get(`/api/conversations/${id}`)).status, 404);
      assert.equal((await a.del(`/api/conversations/${id}`)).status, 404);
    });

    test("DELETE /api/account removes all of that user's rows", async () => {
      const wrong = await a.del('/api/account', { password: 'not the password' });
      assert.equal(wrong.status, 401);

      const res = await a.del('/api/account', { password: PASSWORD });
      assert.equal(res.status, 200, res.text);
      assert.equal(a.jar.size, 0, 'session cookies cleared');
      created.splice(created.indexOf(a), 1);

      // The account is gone...
      const login = await new Client().post('/api/auth/login', { email: email('a'), password: PASSWORD });
      assert.equal(login.status, 401);
      // ...and a new account on the same email starts empty and can't reach the old rows.
      const { client: again } = await signUp('a');
      assert.equal((await again.get('/api/conversations')).json.conversations.length, 0);
      assert.equal((await again.get(`/api/conversations/${convoId}`)).status, 404);
    });
  });
});
