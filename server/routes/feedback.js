import { Router } from 'express';
import { audit, db } from '../db.js';
import { deny, isOwner, isReviewerOf } from '../auth.js';

const router = Router();

// F-a "hộp thư": reviewer của track gửi được...
router.post('/tracks/:id/feedback', (req, res) => {
  const { id } = req.params;
  if (!isReviewerOf(req, id)) return deny(req, res, `missing role us-trk-${id}-reviewer`);
  const { ciphertext } = req.body ?? {};
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return res.status(400).json({ error: 'ciphertext must be a non-empty string' });
  }
  db.prepare(
    `insert into feedback (track_id, author_sub, ciphertext, created_at) values (?, ?, ?, ?)`,
  ).run(id, req.auth.sub, ciphertext, new Date().toISOString());
  audit(req.auth.sub, 'POST feedback', `fb:${id}`, '200');
  res.status(201).json({ ok: true });
});

// ...nhưng chỉ Owner đọc.
router.get('/tracks/:id/feedback', (req, res) => {
  const { id } = req.params;
  if (!isOwner(req)) return deny(req, res, 'missing role us-owner');
  const rows = db
    .prepare(`select id, ciphertext, created_at from feedback where track_id = ? order by id`)
    .all(id);
  audit(req.auth.sub, 'GET feedback', `fb:${id}`, '200');
  res.json({ feedback: rows });
});

export default router;
