# Network prototype

Chat with an LLM about who you are and what you want, and watch a branching map of people to network with grow next to the chat. Click any connection for why they matter, talking points, and a LinkedIn search link.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

1. Open `.env` and replace `sk-your-key-here` with your OpenAI API key.
2. In this folder, run:

   ```bash
   npm install
   npm start
   ```

3. Open http://localhost:3000

No key yet? It still runs with demo data (you'll see a "demo data" badge), so you can try the interface first.

## How it works

```
public/index.html   chat panel + map layout
public/styles.css   all styling
public/app.js       chat logic and the D3 branching map
server.js           Express server; calls OpenAI and keeps your key off the browser
mock.js             demo map used when no key is set
.env                your API key, model, and port (never commit this)
```

- The browser sends the conversation to `POST /api/network`.
- The server asks OpenAI for a **structured JSON map**: a goal, 3-5 branches (categories of people), and 2-4 connections per branch, each with a reason, talking points, and a search query.
- The browser draws it as a tree: goal → branches → connections. Follow-up messages ("focus on Seattle", "add design roles") redraw the full map.

To change the model, edit `OPENAI_MODEL` in `.env`. The prompt and JSON shape live at the top of `server.js`.

## Notes for the next version

- **Real people.** An LLM alone can't reliably return real, current people, so connections are specific *profiles* to search for (role + org + shared tie). Returning actual named people means plugging in a people-data source and having the model rank those results.
- **Coffee-chat practice.** The "Practice coffee chat" button in the detail panel is the placeholder for the agent that role-plays the selected connection. Each connection already carries the context that agent would need.
