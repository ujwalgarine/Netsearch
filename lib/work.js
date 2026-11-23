// Routes for "Work and projects" (the lookup itself is lib/enrich.js), mounted at /api for
// signed-in users only. The browser asks when a person's panel opens and keeps the result on the
// map, so each person is looked up about once a month. Exa reads the pages; GitHub, ORCID and
// OpenAlex are read through their public APIs. GITHUB_TOKEN and OPENALEX_API_KEY only raise limits.

import express from 'express';
import rateLimit from 'express-rate-limit';
import * as defaultStore from './store.js';
import { findWork } from './enrich.js';
import { createFetcher } from './sources/http.js';
import { mockWork } from '../mock.js';

export function workRoutes({
  openai = null,
  model = '',
  exaKey = null,
  githubToken = null,
  openalexKey = null,
  stackKey = null,
  optout = new Set(),
  perDay = 60,
  store = defaultStore,
  fetchImpl,
  sendError = (res, err) => res.status(500).json({ error: String(err?.message ?? err) }),
} = {}) {
  const router = express.Router();
  const ctx = { ...createFetcher(fetchImpl ? { fetchImpl } : {}), exaKey, githubToken, openalexKey, stackKey };

  // The cost cap: a day's lookups per user (each is about 5 to 8 API calls).
  const limiter = rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    limit: perDay,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipFailedRequests: true, // only lookups that ran count
    keyGenerator: (req) => req.auth.user.id,
    handler: (_req, res) => res.status(429).json({ error: "You've used today's work lookups. They reset within a day." }),
  });

  router.post('/people/work', limiter, async (req, res, next) => {
    try {
      const { db, user } = req.auth;
      const personKey = String(req.body?.personKey ?? '').slice(0, 2000);
      if (!personKey) return res.status(400).json({ error: 'Say whose work to look up.' });
      // The person comes from the saved map, never from the request, so only people on your own maps are looked up.
      const subject = await store.mapPerson(db, user.id, String(req.body?.conversationId ?? ''), personKey);
      if (!subject) return res.status(404).json({ error: 'Not found.' });
      const blocked = Array.isArray(subject.person.work?.blocked) ? subject.person.work.blocked.map(String).slice(0, 50) : [];
      if (personKey.startsWith('demo-')) return res.json({ work: mockWork({ blocked }) });
      if (!exaKey) return res.status(503).json({ error: 'Work lookups are off. Add EXA_API_KEY to .env and restart the server.' });
      try {
        res.json({ work: await findWork({ ...subject, ctx, openai, model, blocked, optout }) });
      } catch (err) {
        sendError(res, err);
      }
    } catch (err) {
      next(err);
    }
  });

  // A tracked person's work, read from their map (the Connections page shows it).
  router.get('/connections/:id/work', async (req, res, next) => {
    try {
      const subject = await store.connectionPerson(req.auth.db, req.auth.user.id, req.params.id);
      if (!subject) return res.status(404).json({ error: 'Not found.' });
      res.json({ work: subject.person?.work ?? null, conversationId: subject.connection.conversation_id, personKey: subject.connection.person_key });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
