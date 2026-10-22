import { Router } from 'express';
import { audit, db } from '../db.js';
import { deny, isAuthor } from '../auth.js';
import { readDenial } from './papers.js';

const router = Router();
const findPaper = (id) => db.prepare(`select * from papers where id = ?`).get(id);

// D3 "hộp thư": người phản biện còn hạn gửi được nhận xét đã mã hóa...
router.post('/papers/:id/feedback', (req, res) => {
  const paper = findPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: 'no such paper' });
  if (isAuthor(req)) return deny(req, res, 'authors do not submit feedback');
  const reason = readDenial(req, paper);
  if (reason) return deny(req, res, reason);
  const { ciphertext } = req.body ?? {};
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return res.status(400).json({ error: 'ciphertext must be a non-empty string' });
  }
  db.prepare(
    `insert into feedback (paper_id, author_sub, ciphertext, created_at) values (?, ?, ?, ?)`,
  ).run(paper.id, req.auth.sub, ciphertext, new Date().toISOString());
  audit(req.auth.sub, 'POST feedback', `fb:${paper.id}`, '200');
  res.status(201).json({ ok: true });
});

// ...nhưng chỉ nhóm tác giả đọc.
router.get('/papers/:id/feedback', (req, res) => {
  const { id } = req.params;
  if (!isAuthor(req)) return deny(req, res, 'missing role ps-author');
  const rows = db
    .prepare(`select id, ciphertext, created_at from feedback where paper_id = ? order by id`)
    .all(id);
  audit(req.auth.sub, 'GET feedback', `fb:${id}`, '200');
  res.json({ feedback: rows });
});

export default router;
