# Network prototype

Chat with an LLM about who you are and what you want, and watch a branching map of real people to network with grow next to the chat. Click anyone for a summary of their background, why they're worth meeting, what you have in common, talking points, and a link to their actual profile.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer and a free [Supabase](https://supabase.com) project. Supabase holds accounts, saved chats and maps.

1. **Set up Supabase (once).**
   1. Open **SQL Editor**, paste in all of [supabase/schema.sql](supabase/schema.sql), and click **Run**. This creates the tables and the row level security rules that keep each user's data private.
   2. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". Accounts are email + password, with no verification email.
2. **Fill in `.env`.**
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY`: in Supabase under **Project Settings → API**. Use the publishable (anon) key, never the secret or service_role key.
   - `OPENAI_API_KEY`: plans the branches and writes the details and talking points.
   - `EXA_API_KEY`: finds real people. Create a free key at [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys). The free tier gives $10 of credits every month, no card needed.
3. **Install and start.** In this folder, run:

   ```bash
   npm install
   npm start
   ```

4. **Open it.** Go to http://localhost:3000 and click **Get started** to create an account. The app lives at http://localhost:3000/app.

No OpenAI key yet? It still runs with demo data (you'll see a "demo data" badge), so you can try the interface first. With only the OpenAI key, branches are planned but people search is off (you'll see a "people search off" badge).

To run the API tests, use `npm test`. They need the Supabase setup above. See [ARCHITECTURE.md](ARCHITECTURE.md) for how the app fits together.

## Your account

- Every chat and its map are saved to your account as you go. The address becomes `/app/c/…` after the first reply, so a reload or a restart brings you back to it.
- **Past chats** lists your chats by day, with a title search. You can open a chat to keep refining it, or rename or delete it.
- **Save connection** in a person's panel marks them as someone you want to reach out to.
- **Account** shows your name and email, and has sign out and delete account (this needs your password and typing DELETE).
- **Connections**, **Practice** and **Insights** are placeholders for upcoming features.

## Shaping the map

The chat gets you a first map; after that you can edit it directly.

- **Edit a branch:** click its pill (or Tab to it and press Enter). Rename it, change why it matters, or change **Who to find** (the plain-English people search), then **Save & search again**. **Find 4 more** adds people without replacing the ones you have.
- **New branch:** click **+ New branch** on the map (or **+ Branch** in the toolbar), name it, and describe who to find.
- **Merge branches:** drag one branch onto another, or use **Merge** in the toolbar to pick two or more. People are combined and duplicates removed.
- **Move or remove people:** drag a person card onto another branch, or use **Move to branch…** / **Remove from map** in their panel.
- **Your goal and background:** click the goal at the root. **About you** is what talking points and shared ties are based on.
- **Undo:** the toolbar button, Ctrl/Cmd+Z, or the Undo button in the toast that follows any remove, move, merge, or delete.
- **Room to look:** hide the chat with the sidebar button or `\`. Collapse a branch with the count/caret on its pill (or ←/→ when it has focus). Zoom with + / − / fit at the bottom left.
- **Panel sizes:** drag the edge of the chat or the person panel to resize it (double-click the edge to reset), or use the widen button in its corner. The edge is keyboard-focusable too: ←/→ resize (Shift for bigger steps), Home/End jump to min/max, Enter toggles wide. Widths are remembered in your browser. Prep and Profile stay on separate tabs at any width. On phones the same button makes the sheet taller.
- **Reading a person:** opening someone dims the other branches. Step through a branch with ‹ › or ←/→; **Prep** has the talking points (hover to copy), **Profile** has the facts behind them; move/remove live under ⋯.
- Chat follow-ups ("add a branch for design-to-PM switchers", "drop the recruiters") build on your edited map instead of replacing it.
- The map is saved to your account as you edit, so a reload picks up where you left off.

### Practice a coffee chat

Open **Practice** in the sidebar, or press **Practice coffee chat** on any saved connection.

- **Set up:** pick the connection, your goal (learn about their role, advice on breaking in, ask for a referral, or your own), their mood (friendly, busy, skeptical) and the length (8, 14 or 20 of your messages). Their talking points stay on screen as a cheat sheet.
- **Chat:** you talk to a stand-in with a made-up first name who matches the person's role and background. It is never presented as the real person. Replies stream in as they're written. **Hint** asks a coach for one next question, shown only to you and never added to the transcript. **End chat** works any time, and the chat ends itself at the turn limit.
- **Feedback:** an overall score out of 10; six rubric scores out of 5 (opening, curiosity, listening, specificity about yourself, the ask, the close), each quoting your own words; 3 strengths and 3 things to try; one of your lines rewritten; and a follow-up message draft. Every quote is checked on the server to be word for word from your messages.
- **History:** every session is listed under Practice, with its transcript and report. **Insights** charts your score over time once you've finished two.
- Without an OpenAI key, the persona rotates through 6 demo lines and the feedback is a deterministic demo report, both labelled **Demo**.

## How it works

```
public/tokens.css   design tokens + shared buttons, glass, type ("Sky & Signal", see design inspiration/design.md)
public/field.js     dot-matrix wave background, shared by the landing page and the map
public/landing.*    landing page, served at /
public/landing-hero.js   the hero: preloader, log canvas with cursor-grown moss, GSAP intro
public/login.html, signup.html, auth.*   sign-in and sign-up pages
public/app.html     app shell (sidebar + views), served at /app/*
public/shell.js     app routes, Past chats, Account   (shell.css: their styles)
public/practice.*   Practice: setup, the streamed role-play chat, the feedback report, history
public/styles.css   app styling
public/app.js       chat, map editing, and the D3 branching map
public/assets/      landing page images (map-example.jpg is a screenshot of the app with illustrative people)
server.js           Express server; keeps your API keys off the browser
people.js           Exa people search + talking points grounded in each profile
mock.js             demo data used when no OpenAI key is set
lib/auth.js          sign up / sign in / sessions (Supabase Auth, HttpOnly cookies)
lib/store.js         saved chats, map versions and connections
lib/practice.js      practice sessions: persona / coach / report prompts, demo mode, report schema + quote check
supabase/schema.sql  database tables + row level security (run once in Supabase)
.env                your API keys, model, and port (never commit this)
```

1. `POST /api/network`: the model turns the conversation (and the saved, possibly hand-edited map) into branches, and the turn is saved to your account. Each branch has a plain-English people search. The model never names people itself.
2. `POST /api/people`: for each branch, [Exa](https://exa.ai) people search returns real public profiles (name, role, work history, education, profile URL, profile text). The model then reads those profiles and writes the summary, why reach out, what's in common, and talking points, using only facts on the profile. Company pages and poor fits are dropped.

Branches fill in one at a time as their searches finish. A map of four branches costs roughly 4 Exa searches (about $0.01 each) plus one OpenAI call per branch.

To change the model, edit `OPENAI_MODEL` in `.env`. The planner prompt lives in `server.js`; the profile prompt lives in `people.js`.

## Limits worth knowing

- Results are public profiles Exa has indexed. Coverage is strong for working professionals and thinner for students and very new grads.
- Profiles can be out of date. Check the linked profile before reaching out.
- Most links go to LinkedIn, but some go to personal sites or other profile pages; the button says which.
- Practice POSTs share the per-user AI limit with tips: 20 requests per 10 minutes. A long (20-turn) practice chat plus its start and feedback needs 22, so a very fast long chat can hit the limit.
