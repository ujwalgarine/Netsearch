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
- **Practice** lists your practice coffee chats with their grades, and starts a new one with anyone you're tracking (see [Practice coffee chat](#practice-coffee-chat)).
- **Connections** and **Insights** are placeholders for upcoming features.

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

## Practice coffee chat

Track someone (set them to Saved or later in their panel or on **Connections**), then use **Practice coffee chat** there, or pick them on the **Practice** page. The practice room opens at `/app/practice/new?connection=…`, where you rehearse the conversation with a fictional practice partner and get a graded report at the end. **Practice** also has a sample partner, so you can try it before tracking anyone.

- **Who you talk to.** An invented character (made-up name, clearly labeled) who shares the person's role and kind of background, built from their profile on your map, your map's goal, and what you told the app about yourself. It is not the real person: their name is stripped before anything reaches the model, and the character is told never to claim to be a real individual. If you are rude it cools off, says so once, and ends the chat if it continues.
- **Typing or talking.** Type, or allow the microphone and speak your side. The setup screen checks the mic first: a level bar shows it hears you and, with the browser's recogniser, the words it heard. Speech to text uses the browser's built-in Web Speech API (Chrome, Edge, Safari); in Chrome and Edge that step runs on the browser maker's speech service and this app never receives audio. Where the browser has no working recogniser (Firefox, Brave, Opera, Vivaldi, in-app browsers), the page notices (an error, or no answer within 5 seconds) and, if the server has an OpenAI key, switches to recording each spoken turn in the browser and transcribing it on the server with OpenAI; without a key it says why and you type. Every mic problem gets a specific message: blocked permission, blocked by the operating system, no mic, mic busy in another app, or a non-secure page (the mic only works on `http://localhost` or HTTPS, so opening the app by LAN address from another device will not work).
- **Their voice.** With an OpenAI key, replies are read by OpenAI's natural voices (`gpt-4o-mini-tts`), with each fictional character keeping one voice and the delivery following their mood. Without a key, the page picks the most natural voice the device has (Edge "Natural" voices, Apple Enhanced/Premium, Google voices first; novelty and old robotic voices last). A voice picker, a speed slider and a "Hear a sample" button are on the setup screen and in the chat's side panel.
- **Camera (optional).** Expression, attention, stillness and hand gestures are measured in the browser with MediaPipe. Video is never recorded or uploaded. Only percentages such as "smiling 30% of the time" are sent with the report request.
- **The report.** Overall grade, 12 scores in three groups (Voice, Conversation, Presence), the character's hidden interest over time, key moments, three tips, and the transcript. Anything that was not measured (typed chat, camera off) is left out of the grade.
- **What is saved.** Starting a chat saves a practice session for your account (and a `practice_started` event). Ending it saves the score, the report and the transcript (and `practice_completed`, which Insights counts). A chat you leave before the end keeps no transcript. Open a past report from **Practice**, or delete it there; deleting your account deletes them all.
- **Cost.** Uses the same `OPENAI_API_KEY` and `OPENAI_MODEL` as the rest of the app: one small call per reply and one for the written feedback. With a key, each reply is also spoken by `OPENAI_TTS_MODEL` (default `gpt-4o-mini-tts`), and spoken turns are transcribed by `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`) only in browsers without a working recogniser; both are fractions of a cent per turn. With no key it runs a scripted demo partner, rule-based feedback and device voices, so the whole thing can be tried for free.

Security and privacy, in short: the key stays on the server; `/api/practice/*` needs a signed-in user and is rate limited (60 requests a minute per user), with a 3 MB cap on recorded audio and per-message length caps; the speech route only reads out replies this server signed (or a fixed sample), so it cannot be used as a free text-to-speech service on your key; recordings are passed to OpenAI and dropped, never stored; the practice room is served with its own strict Content-Security-Policy (scripts, models, audio and API calls from this server only) and a Permissions-Policy limiting camera and microphone to that page.

Camera analysis uses `@mediapipe/tasks-vision` pinned to 0.10.35, the last release that does not send usage metrics to Google, served from `node_modules`. The two model files in `public/vendor/models/` are Google's published MediaPipe models (Apache 2.0), copied unchanged:

| File | Source | SHA-256 |
|---|---|---|
| `face_landmarker.task` | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/` | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `hand_landmarker.task` | `storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/` | `fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1` |

## How it works

```
public/tokens.css   design tokens + shared buttons, glass, type ("Moss & Signal", see design inspiration/design.md)
public/field.js     dot-matrix wave background, shared by the landing page and the map
public/landing.*    landing page, served at /
public/login.html, signup.html, auth.*   sign-in and sign-up pages
public/app.html     app shell (sidebar + views), served at /app/*
public/shell.js     app routes, Past chats, Account   (shell.css: their styles)
public/practice.js  the Practice page: start a practice chat, past reports
public/practice-room.*  the practice room (its own page): conversation, voice, report
public/practice-voice.js   speech in and out: mic errors, recogniser fallback, recording, voice ranking and playback
public/practice-vision.js  on-device camera analysis (MediaPipe face + hand landmarks)
public/vendor/models/      the two MediaPipe model files
public/styles.css   app styling
public/app.js       chat, map editing, and the D3 branching map
public/assets/      landing page images (map-example.jpg is a screenshot of the app with illustrative people)
server.js           Express server; keeps your API keys off the browser
people.js           Exa people search + talking points grounded in each profile
mock.js             demo data used when no OpenAI key is set
lib/auth.js          sign up / sign in / sessions (Supabase Auth, HttpOnly cookies)
lib/store.js         saved chats, map versions, connections and practice sessions
lib/practice.js      practice chat: the fictional partner, demo partner, report scoring, voice, /api/practice routes
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

## Limits of the practice chat

- Camera thresholds (what counts as a smile, looking away, a gesture) are first-pass values. Treat Presence scores as rough until they are calibrated on real sessions.
- Browser speech recognition drops most "um"s and all punctuation, so filler counts run low and questions are detected by phrasing. Server transcription is prompted to keep fillers.
- Real microphones, real browser recognisers, device voices and live OpenAI speech and transcription calls have not been tested in a real browser yet; the checks ran in headless Chromium with a fake microphone, stubbed recognisers and voices, and a stubbed OpenAI client. The voice-activity threshold that decides when you have stopped talking (server transcription only) is a first-pass value.
