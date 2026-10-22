import express from 'express';
import { existsSync } from 'node:fs';
import { audit, db } from './db.js';
import { requireAuth } from './auth.js';
import tracks from './routes/tracks.js';
import feedback from './routes/feedback.js';
import shares from './routes/shares.js';
import operator from './routes/operator.js';
import auditRoutes from './routes/audit.js';

const APP_ORIGIN = process.env.CLIENT_APP_URL ?? 'http://localhost:5137';

export const app = express();

// frame-src *: enclave Tide được nhúng trong iframe (tide_dpop_auth.html).
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-src *");
  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, DPoP, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/me', requireAuth, (req, res) => {
  const { sub, tideuserkey, username, roles, isApprover } = req.auth;
  if (tideuserkey) {
    db.prepare(
      `insert into users (tideuserkey, sub, username, first_seen) values (?, ?, ?, ?)
       on conflict(tideuserkey) do update set sub = excluded.sub, username = excluded.username`,
    ).run(tideuserkey, sub, username ?? null, new Date().toISOString());
  }
  audit(sub, 'GET me', null, '200');
  res.json({ sub, tideuserkey, username, roles, is_approver: isApprover });
});

app.use('/api', requireAuth, tracks, feedback, shares, operator, auditRoutes);

for (const dir of ['public', 'dist']) {
  if (existsSync(new URL(`../${dir}`, import.meta.url))) {
    app.use(express.static(new URL(`../${dir}/`, import.meta.url).pathname));
  }
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'body too large' });
  res.status(500).json({ error: 'internal error' });
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => console.log(`Unreleased Studio API on http://localhost:${port}`));
}
