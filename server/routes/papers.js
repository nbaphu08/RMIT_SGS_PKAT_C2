import { Router, raw } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOB_DIR, audit, db } from '../db.js';
import { deny, isAuthor, isReaderOf, requireApprover, requireRole } from '../auth.js';

export const blobPath = (paperId) => join(BLOB_DIR, `doc-${paperId}.bin`);

const router = Router();
const RECORDS = ['doc', 'fb'];
const findPaper = (id) => db.prepare(`select * from papers where id = ?`).get(id);

/**
 * Lý do từ chối đọc, hoặc null nếu được đọc: tác giả đọc mọi paper; người khác cần role
 * khớp ĐÚNG :id (chặn IDOR) và còn trong hạn phản biện (mục 3.3, 3.4).
 * Lớp hạn này chỉ để trải nghiệm tốt — hạn thật do policy đã ký ở ORK thực thi (T16).
 */
export function readDenial(req, paper) {
  if (isAuthor(req)) return null;
  if (!isReaderOf(req, paper.id)) return `missing role ps-paper-${paper.id}-reader`;
  if (!paper.review_until || paper.review_until <= new Date().toISOString()) {
    return `review window for ${paper.id} has closed`;
  }
  return null;
}

// Tác giả thấy cả 3 paper; người khác chỉ thấy paper mà JWT có role reader tương ứng
// (kể cả khi đã hết hạn, để UI hiện được "hết hạn" — mở blob vẫn 403).
router.get('/papers', (req, res) => {
  const rows = db
    .prepare(`select id, code_title, review_until, blob_size, updated_at from papers order by id`)
    .all();
  res.json({ papers: isAuthor(req) ? rows : rows.filter((r) => isReaderOf(req, r.id)) });
});

router.put(
  '/papers/:id/blob',
  requireRole('ps-author'),
  raw({ type: '*/*', limit: '15mb' }),
  (req, res) => {
    const paper = findPaper(req.params.id);
    if (!paper) return res.status(404).json({ error: 'no such paper' });
    writeFileSync(blobPath(paper.id), req.body);
    db.prepare(`update papers set blob_size = ?, updated_at = ? where id = ?`).run(
      req.body.length,
      new Date().toISOString(),
      paper.id,
    );
    audit(req.auth.sub, 'PUT blob', `doc:${paper.id}`, '200');
    res.json({ id: paper.id, blob_size: req.body.length });
  },
);

router.get('/papers/:id/blob', (req, res) => {
  const paper = findPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: 'no such paper' });
  const reason = readDenial(req, paper);
  if (reason) return deny(req, res, reason);
  if (!existsSync(blobPath(paper.id))) return res.status(404).json({ error: 'not uploaded yet' });
  audit(req.auth.sub, 'GET blob', `doc:${paper.id}`, '200');
  res.type('application/octet-stream').send(readFileSync(blobPath(paper.id)));
});

// Chỉ trả policy có subject khớp người gọi (User = tideuserkey của chính họ, hoặc Role trong JWT).
router.get('/papers/:id/policy', (req, res) => {
  const record = req.query.for ?? 'doc';
  if (!RECORDS.includes(record)) return res.status(400).json({ error: 'for must be doc|fb' });
  const paper = findPaper(req.params.id);
  if (!paper) return res.status(404).json({ error: 'no such paper' });
  const reason = readDenial(req, paper);
  if (reason) return deny(req, res, reason);
  const rows = db
    .prepare(`select subject_kind, subject, policy from policies where paper_id = ? and record = ?`)
    .all(paper.id, record);
  const mine = rows.filter((p) =>
    p.subject_kind === 'User'
      ? p.subject === req.auth.tideuserkey
      : req.auth.roles.includes(p.subject),
  );
  res.json({ record: `${record}:${paper.id}`, policies: mine });
});

router.post('/papers/:id/policies', requireApprover, (req, res) => {
  const { id } = req.params;
  const { record, subject_kind: subjectKind, subject, policy } = req.body ?? {};
  if (!findPaper(id)) return res.status(404).json({ error: 'no such paper' });
  if (!RECORDS.includes(record)) return res.status(400).json({ error: 'record must be doc|fb' });
  if (!['User', 'Role'].includes(subjectKind)) {
    return res.status(400).json({ error: 'subject_kind must be User|Role' });
  }
  if (typeof subject !== 'string' || !subject || typeof policy !== 'string' || !policy) {
    return res.status(400).json({ error: 'subject and policy are required strings' });
  }
  db.prepare(
    `insert into policies (paper_id, record, subject_kind, subject, policy, created_at, created_by)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, record, subjectKind, subject, policy, new Date().toISOString(), req.auth.sub);
  audit(req.auth.sub, 'POST policy', `${record}:${id}`, '200');
  res.status(201).json({ record: `${record}:${id}`, subject_kind: subjectKind, subject });
});

export default router;
