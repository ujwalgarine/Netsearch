# NetPrep architecture

Read this first before changing the app. It covers the file map, routes, database, auth flow and tests.

## Stack

- **Server:** Node 18+ and Express. It also uses `openai`, `dotenv`, `helmet`, `cookie-parser`, `express-rate-limit` and `@supabase/supabase-js`.
- **Accounts and database:** [Supabase](https://supabase.com). Supabase Auth handles users, password hashing and sessions, and Postgres holds the data. Only the server talks to Supabase. It uses the project's publishable (anon) key, never the secret (service_role) key.
- **Frontend:** plain HTML, CSS and JS, with D3 v7 from cdnjs. There is no framework and no build step. Classic `<script>` tags share one global scope, so `shell.js` can call functions defined in `app.js`.

## File map

```
server.js              Express app: security headers, page routes, all /api routes, the planner (planTurn), people search
lib/auth.js            Supabase auth: session cookies, refresh, page/API guards, signup/login/logout/me, rate limits, Origin check
lib/store.js           Data access: conversations, messages, map versions, connections (list, filters, status/notes/follow-up), all filtered by user_id
lib/insights.js        Insights summary (KPIs, funnel, mix, 12-week activity, follow-ups) and networking tips (summary → hash → tips_cache)
people.js              Exa people search + the model writing each person's summary and talking points
mock.js                Demo plan/people when there's no OpenAI key
supabase/schema.sql    Tables, indexes, row level security, delete_my_account(). Run it in the Supabase SQL editor.
tests/helpers.js       Test server on a random port, cookie-keeping client, direct-to-database client
tests/api.test.js      Auth, conversations, maps
tests/insights.test.js Connections, insights summary, tips cache

public/tokens.css      "Moss & Signal" design tokens + shared primitives (see design inspiration/design.md)
public/field.js        Dot-matrix wave canvas used on every page
public/landing.*       Landing page at /
public/login.html      /login        ┐ share public/auth.css and public/auth.js
public/signup.html     /signup       ┘
public/app.html        The app at /app/*: sidebar shell + all views
public/shell.css       Sidebar / bottom tab bar, Past chats, Account, dialogs
public/shell.js        Client router, sidebar, Past chats, Account, sign out
public/connections.js  Connections page + the shared tracker (status pipeline, follow-up date, autosaved notes) used on the map too
public/insights.js     Insights page: KPI tiles, D3 charts (with tooltips and table views), follow-ups, tips
public/insights.css    Styles for Connections and Insights
public/styles.css      Chat + map + detail panel styles
public/app.js          Chat, D3 map, editing, saving the open chat (startNewMap / openConversation / save)
```

## Pages

| Path | Signed out | Signed in |
|---|---|---|
| `/` | landing (CTAs → /signup) | landing (CTAs → /app, nav shows "Open app") |
| `/login`, `/signup` | the form | redirect to `next` (or `/app`) |
| `/app`, `/app/*` | redirect to `/login?next=<path>` | `app.html`; `shell.js` picks the view |

App views (client routes in `shell.js`): `/app` (new map), `/app/c/:id` (a saved chat), `/app/chats`, `/app/connections`, `/app/connections/:id` (with its detail sheet open), `/app/practice` and `/app/practice/new?connection=<id>` (still a placeholder: the next step builds it), `/app/insights`, `/app/account`.

`next` values are only followed if they are same-site relative paths (`safeNext` in `lib/auth.js`).

## API

Every write (POST, PUT, PATCH or DELETE) must carry an `Origin` header matching the host (`X-Forwarded-Host` behind a proxy). Otherwise the server returns 403. Every `/api/*` route except `/api/auth/*` returns 401 JSON when signed out. Records owned by someone else return 404.

| Method & path | Body | Returns |
|---|---|---|
| POST `/api/auth/signup` | `{name, email, password, next?}` | 201 `{user, redirect}`; 400 `{error, fields}`; 409 if the email exists; 429 after 10 sign-ups per hour per IP |
| POST `/api/auth/login` | `{email, password, next?}` | `{user, redirect}`; 401 "Email or password is incorrect."; 429 after 5 failures per 15 minutes per IP+email |
| POST `/api/auth/logout` | | `{ok}`; revokes the Supabase session and clears the cookies |
| GET `/api/auth/me` | | `{user: {id, email, name}}` or 401 |
| GET `/api/auth/session` | | `{signedIn}`, always 200 (the landing page uses it) |
| DELETE `/api/account` | `{password}` | `{ok}`; deletes the user and, by cascade, all of their rows |
| GET `/api/status` | | `{mock, people, model}` |
| GET `/api/conversations` | | `{conversations: [{id, title, updated_at, connection_count}]}`, newest first |
| GET `/api/conversations/:id` | | `{id, title, messages, map, version, statuses}`; `statuses` is person id → connection status |
| PATCH `/api/conversations/:id` | `{title}` | `{id, title, updated_at}` |
| DELETE `/api/conversations/:id` | | `{ok}` |
| POST `/api/network` | `{conversationId?, message}` | `{conversationId, reply, goal, profile, branches}`. Plans the turn, then saves the user message, the reply and a new map version, and syncs connections. Creates the conversation (titled with the goal) when no id is given. |
| PUT `/api/conversations/:id/map` | `{map}` | `{ok, version}`. Saves edits and finished people searches into the latest map version, and syncs connections. |
| PATCH `/api/conversations/:id/connections` | `{personKey, status?, notes?, follow_up_on?}` | The full connection row + `personKey`. Used by the map's person panel (people are matched by their id on the map). |
| GET `/api/connections` | query: `status` (`tracked` default = all but suggested, `all`, or one status), `branch`, `conversation`, `q` (name/title/organization), `facets=1` | `{connections: [row + conversation_title], facets?: {branches, conversations, suggested}}` |
| PATCH `/api/connections/:id` | `{status?, notes?, follow_up_on?}` | The full row. A real status change stamps `status_updated_at` and logs `connection_status_changed`; notes/date alone log nothing. 400 on bad values, 404 if not yours. |
| GET `/api/insights/summary` | query: `today=YYYY-MM-DD` (the browser's date, for follow-ups) | `{today, kpis, funnel, mix, activity: {weeks}, followups}` (see Insights below) |
| POST `/api/insights/tips` | | `{tips, source: 'llm' \| 'demo' \| 'starter', cached, generated_at?}`. Rate limited to 20 per 10 minutes per user. |
| POST `/api/people` | `{goal, profile, branch, exclude, count}` | `{people}`. Exa search + write-ups (not saved; the browser saves the map afterwards). |

### How one chat turn flows

1. The browser flushes any pending map edit (`PUT .../map`).
2. It calls `POST /api/network`. The server reads the history and the latest map from the database, runs the unchanged planner (`planTurn`: the same prompt and JSON schema, or `mockPlan` without a key), and then merges the plan into the map the same way the browser does (`mergePlan`). Kept branches keep their people, and new or refreshed branches start empty. It saves all of this as map version N+1.
3. The browser applies the plan, changes the URL to `/app/c/:id`, and calls `POST /api/people` for each new branch.
4. As people arrive, and on every manual edit (move, merge, delete, collapse, undo), `save()` writes the whole map to `PUT .../map`, debounced to 800 ms. That updates the latest version in place.

The map JSON keeps the shape `{ goal, profile, branches: [{ id, label, why, query, people, status, error, token, collapsed? }] }`, and person objects are the ones `people.js` returns. The person `id` (their profile URL) is the connection's `person_key`.

## Insights

Everything is computed on the server from the user's own rows. No numbers are invented, and a new user gets zeros, `reply_rate: null` and empty lists.

- `kpis`: `maps_created` (count of `map_created` events), `connections_saved` (status ≠ suggested), `reached_out` (contacted or later), `replied` (replied or later), `reply_rate` (replied ÷ reached out, `null` when nothing has been contacted), `met`, and `practice_completed` (practice_sessions with status `completed`).
- `funnel`: one entry per stage (saved → contacted → replied → meeting_set → met). `reached` counts connections at that stage or later, `current` counts those there now, and `conversion` is reached ÷ the previous stage's reached.
- `mix`: tracked connections by branch (top 8 plus "Other") and by organization (top 8).
- `activity.weeks`: 12 Monday-start UTC weeks counting `map_created`, `connection_status_changed` and `practice_completed` events.
- `followups`: a `follow_up_on` of today or earlier (`reason: 'follow_up'`), or 7 or more days in `contacted` with no further change (`reason: 'stale'`), sorted by most overdue.

**How tips are made (`lib/insights.js`):**
1. `tipsSummary` builds a compact JSON summary: counts by status, branch and organization, stale contacts, branches with no saved connections, the top organization's share, practice score averages, the goals of the 3 latest maps, and a sample of saved connections (with the ids that actions may point to).
2. With fewer than 3 saved connections, it returns 3 fixed starter tips (`source: 'starter'`) and makes no model call.
3. Otherwise it computes `sha256({summary, mode})`. When that matches `tips_cache.input_hash`, it returns the cached tips (`cached: true`).
4. Otherwise the model writes them with a strict JSON schema (or `demoTips` builds deterministic ones when there's no OpenAI key, `source: 'demo'`). `cleanTips` drops action ids that aren't the user's, and the result is cached.

**Charts** are drawn with D3 in `public/insights.js`:
- Funnel and mix are ranked bars, each label on its own line above its bar.
- Activity is three small-multiple column charts, one per series.
- Lime marks the primary series only (the funnel and outreach). Secondary series use the dim signal color, and "Other" is gray.
- Every chart has a hover/focus tooltip and a Table toggle.

## Database (`supabase/schema.sql`)

All ids are `uuid` or `bigint identity`, and timestamps are `timestamptz` (ISO strings over the API). Every table has a `user_id` that references `auth.users(id) ON DELETE CASCADE`. Child tables also cascade from their parent.

| Table | Columns |
|---|---|
| `auth.users` (Supabase) | id, email, encrypted_password (bcrypt), raw_user_meta_data.name, … |
| `auth.sessions` (Supabase) | the sessions behind the refresh tokens |
| `conversations` | id, user_id, title, created_at, updated_at |
| `messages` | id, user_id, conversation_id, role (user/assistant), content, created_at |
| `maps` | id, user_id, conversation_id, version, goal, data_json, created_at; unique (conversation_id, version) |
| `connections` | id, user_id, conversation_id, person_key, name, profile_url, branch_label, title, organization, why, talking_points_json, search_query, status, notes, follow_up_on, status_updated_at, created_at; unique (conversation_id, person_key) |
| `practice_sessions` | id, user_id, connection_id (nullable, set null), scenario_json, status, score, feedback_json, created_at, ended_at |
| `practice_messages` | id, user_id, practice_session_id, role, content, created_at |
| `tips_cache` | user_id (pk), input_hash, tips_json, created_at |
| `events` | id, user_id, type, ref_id, created_at: an append-only analytics log |

- **Connection status** is one of `suggested | saved | contacted | replied | meeting_set | met`. Saving a map upserts one connection per person on it and refreshes their details but never the status or notes. People taken off the map are deleted only while they're still `suggested`.
- **Events logged so far:** `signup`, `map_created` (the first map version of a conversation) and `connection_status_changed` (only when the status actually changes). `practice_started` and `practice_completed` are for the practice feature.
- **Row level security:** every table allows select, insert, update and delete only where `user_id = auth.uid()`. Inserts and updates on child tables also require the parent to be yours. `events` has no update policy.
- **`delete_my_account()`:** a `security definer` function that deletes `auth.users` where `id = auth.uid()`. It can be executed by `authenticated` only.

**Differences from the original SQLite spec:** `users` and `sessions` are Supabase's own `auth.users` and `auth.sessions`, and the name is stored in user metadata. The `messages`, `maps` and `practice_messages` tables carry a `user_id` so every query and policy can filter on it. `connections` adds `person_key`, `name` and `profile_url` so the people on a map can be matched to their rows.

## Auth flow

- **Sign up:** `POST /api/auth/signup` → `supabase.auth.signUp`. Supabase stores the bcrypt hash and the name goes in user metadata. The server gets a session back, which requires "Confirm email" to be off, and sets the cookies. It logs a `signup` event.
- **Log in:** `signInWithPassword`. Any existing session is revoked first, so a new login always rotates the session. The error is always the generic one.
- **Cookies:** `np_session` (the access JWT), `np_refresh` (the refresh token) and `np_exp` (the fixed 30-day end of the session). All three are `HttpOnly; SameSite=Lax; Path=/`, plus `Secure` when `NODE_ENV=production`.
- **Each request:** `auth.attach` verifies the access token with Supabase (cached for 30 s). If the token has expired, it uses the refresh token and rewrites the cookies. Once the 30 days are up, the session ends. `req.auth = { user, token, db }`, where `db` is a Supabase client acting as the user, so RLS applies on top of the explicit `user_id` filters.
- **Log out:** revokes the session at Supabase (`/auth/v1/logout?scope=local`) and clears the cookies.
- **Delete account:** checks the password with a fresh sign-in, then calls `delete_my_account()`, which cascades to all of the user's rows.
- **Security headers:** `helmet`. The CSP allows scripts only from self and cdnjs, and styles from self, Google Fonts and unpkg (the Phosphor icons). `'unsafe-inline'` is allowed for styles only, because the landing page uses `style="--i: 0"` attributes. Images may come from any `https:` host (profile photos).

## Running and testing

```bash
npm install
npm start        # http://localhost:3000
npm test         # API tests
```

Supabase setup (once):
1. Run `supabase/schema.sql` in the SQL editor.
2. Turn off **Authentication → Sign In / Providers → Email → Confirm email**.
3. Put `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env`.

What the tests do:
- They start `server.js` on a random port in demo mode (`OPENAI_API_KEY` and `EXA_API_KEY` are blanked for the child process) against the Supabase project in `.env`.
- They create throwaway users named `netprep-test-<run>-<who>@example.com` and delete them through `DELETE /api/account` at the end.
- They skip themselves when Supabase isn't configured.
- Supabase has its own auth rate limits, so running the suite many times in a row can hit a 429 from Supabase.
- The check that the stored hash starts with `$2` is marked `todo`, because the public key can't read `auth.users`. Check it in the Supabase dashboard instead.
