# Network prototype

Chat with an LLM about who you are and what you want, and watch a branching map of real people to network with grow next to the chat. Click anyone for a summary of their background, why they're worth meeting, what you have in common, talking points, and a link to their actual profile.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

1. Open `.env` and set:
   - `OPENAI_API_KEY`: plans the branches and writes details and talking points.
   - `EXA_API_KEY`: finds real people. Create a free key at [dashboard.exa.ai/api-keys](https://dashboard.exa.ai/api-keys). The free tier gives $10 of credits every month, no card needed.
2. In this folder, run:

   ```bash
   npm install
   npm start
   ```

3. Open http://localhost:3000 for the landing page, or http://localhost:3000/app for the app.

No keys yet? It still runs with demo data (you'll see a "demo data" badge), so you can try the interface first. With only the OpenAI key, branches are planned but people search is off (you'll see a "people search off" badge).

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
- The map is saved in your browser, so a reload picks up where you left off.

## How it works

```
public/tokens.css   design tokens + shared buttons, glass, type ("Moss & Signal", see design inspiration/design.md)
public/field.js     dot-matrix wave background, shared by the landing page and the map
public/landing.*    landing page, served at /
public/app.html     app layout (chat + map), served at /app
public/styles.css   app styling
public/app.js       chat, map editing, and the D3 branching map
public/assets/      landing page images (map-example.jpg is a screenshot of the app with illustrative people)
server.js           Express server; keeps your API keys off the browser
people.js           Exa people search + talking points grounded in each profile
mock.js             demo data used when no OpenAI key is set
.env                your API keys, model, and port (never commit this)
```

1. `POST /api/plan`: the model turns the conversation (and the current, possibly hand-edited map) into branches. Each branch has a plain-English people search. The model never names people itself.
2. `POST /api/people`: for each branch, [Exa](https://exa.ai) people search returns real public profiles (name, role, work history, education, profile URL, profile text). The model then reads those profiles and writes the summary, why reach out, what's in common, and talking points, using only facts on the profile. Company pages and poor fits are dropped.

Branches fill in one at a time as their searches finish. A map of four branches costs roughly 4 Exa searches (about $0.01 each) plus one OpenAI call per branch.

To change the model, edit `OPENAI_MODEL` in `.env`. The planner prompt lives in `server.js`; the profile prompt lives in `people.js`.

## Limits worth knowing

- Results are public profiles Exa has indexed. Coverage is strong for working professionals and thinner for students and very new grads.
- Profiles can be out of date. Check the linked profile before reaching out.
- Most links go to LinkedIn, but some go to personal sites or other profile pages; the button says which.

## Next

- **Coffee-chat practice.** The "Practice coffee chat" button in the person panel is the placeholder for an agent that role-plays the selected person. Each person already carries the profile context that agent would need.
