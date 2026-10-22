import { Router } from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BLOB_DIR, audit, db } from '../db.js';
import { requireRole } from '../auth.js';
import { blobPath } from './papers.js';

const router = Router();

// Operator có toàn quyền trên storage và DB — Operator Console chứng minh như vậy vẫn không đủ.
router.get('/operator/storage', requireRole('ps-operator'), (req, res) => {
  const files = readdirSync(BLOB_DIR).map((name) => {
    const head = readFileSync(join(BLOB_DIR, name)).subarray(0, 64);
    return {
      name,
      size: statSync(join(BLOB_DIR, name)).size,
      head_hex: head.toString('hex'),
      is_pdf: head.subarray(0, 4).toString('latin1') === '%PDF',
    };
  });
  audit(req.auth.sub, 'GET storage', null, '200');
  res.json({ dir: 'server/data/blobs', files });
});

router.get('/operator/blob/:id', requireRole('ps-operator'), (req, res) => {
  const path = blobPath(req.params.id);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return res.status(404).json({ error: 'not uploaded yet' });
  }
  audit(req.auth.sub, 'GET operator blob', `doc:${req.params.id}`, '200 (by design)');
  res.type('application/octet-stream').send(bytes);
});

// Operator đọc được bảng policies trong DB của chính mình. Cố ý mở để T9 đi tới ORK:
// có ciphertext + policy trong tay mà vẫn bị mạng ORK từ chối giải mã.
router.get('/operator/policy/:id', requireRole('ps-operator'), (req, res) => {
  const rows = db
    .prepare(`select subject_kind, subject, policy from policies where paper_id = ? and record = 'doc'`)
    .all(req.params.id);
  audit(req.auth.sub, 'GET operator policy', `doc:${req.params.id}`, '200 (by design)');
  res.json({ policies: rows });
});

// CỐ Ý cho Operator "gia hạn" trong DB: backend sẽ trả ciphertext, nhưng ORK vẫn từ chối
// vì hạn nằm trong policy đã ký bằng threshold (T16, mục 3.4).
router.patch('/operator/papers/:id/review-until', requireRole('ps-operator'), (req, res) => {
  const { id } = req.params;
  if (!db.prepare(`select 1 from papers where id = ?`).get(id)) {
    return res.status(404).json({ error: 'no such paper' });
  }
  const { review_until: reviewUntil } = req.body ?? {};
  if (typeof reviewUntil !== 'string' || Number.isNaN(Date.parse(reviewUntil))) {
    return res.status(400).json({ error: 'review_until must be an ISO date string' });
  }
  db.prepare(`update papers set review_until = ? where id = ?`).run(reviewUntil, id);
  audit(req.auth.sub, 'PATCH review_until', `doc:${id}`, '200 (by design)');
  res.json({ id, review_until: reviewUntil });
});

export default router;
