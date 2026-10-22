import { Router, raw } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOB_DIR, audit, db } from '../db.js';
import { deny, isOwner, isReviewerOf, requireApprover, requireRole } from '../auth.js';

export const blobPath = (trackId) => join(BLOB_DIR, `trk-${trackId}.bin`);

const router = Router();
const RECORDS = ['trk', 'fb'];
const findTrack = (id) => db.prepare(`select * from tracks where id = ?`).get(id);

// Owner thấy cả 3 track; người khác chỉ thấy track mà JWT có role reviewer tương ứng.
router.get('/tracks', (req, res) => {
  const rows = db.prepare(`select id, title, blob_size, updated_at from tracks order by id`).all();
  res.json({ tracks: isOwner(req) ? rows : rows.filter((r) => isReviewerOf(req, r.id)) });
});

router.put(
  '/tracks/:id/blob',
  requireRole('us-owner'),
  raw({ type: '*/*', limit: '15mb' }),
  (req, res) => {
    const track = findTrack(req.params.id);
    if (!track) return res.status(404).json({ error: 'no such track' });
    writeFileSync(blobPath(track.id), req.body);
    db.prepare(`update tracks set blob_size = ?, updated_at = ? where id = ?`).run(
      req.body.length,
      new Date().toISOString(),
      track.id,
    );
    audit(req.auth.sub, 'PUT blob', `trk:${track.id}`, '200');
    res.json({ id: track.id, blob_size: req.body.length });
  },
);

// Role phải khớp ĐÚNG :id — đây là chặn IDOR của demo moment (bước 8).
router.get('/tracks/:id/blob', (req, res) => {
  const { id } = req.params;
  if (!isOwner(req) && !isReviewerOf(req, id)) {
    return deny(req, res, `missing role us-trk-${id}-reviewer`);
  }
  if (!findTrack(id)) return res.status(404).json({ error: 'no such track' });
  if (!existsSync(blobPath(id))) return res.status(404).json({ error: 'not uploaded yet' });
  audit(req.auth.sub, 'GET blob', `trk:${id}`, '200');
  res.type('application/octet-stream').send(readFileSync(blobPath(id)));
});

// Chỉ trả policy có subject khớp người gọi (User = tideuserkey của chính họ, hoặc Role trong JWT).
router.get('/tracks/:id/policy', (req, res) => {
  const { id } = req.params;
  const record = req.query.for ?? 'trk';
  if (!RECORDS.includes(record)) return res.status(400).json({ error: 'for must be trk|fb' });
  if (!isOwner(req) && !isReviewerOf(req, id)) {
    return deny(req, res, `missing role us-trk-${id}-reviewer`);
  }
  const rows = db
    .prepare(`select subject_kind, subject, policy from policies where track_id = ? and record = ?`)
    .all(id, record);
  const mine = rows.filter((p) =>
    p.subject_kind === 'User'
      ? p.subject === req.auth.tideuserkey
      : req.auth.roles.includes(p.subject),
  );
  res.json({ record: `${record}:${id}`, policies: mine });
});

router.post('/tracks/:id/policies', requireApprover, (req, res) => {
  const { id } = req.params;
  const { record, subject_kind: subjectKind, subject, policy } = req.body ?? {};
  if (!findTrack(id)) return res.status(404).json({ error: 'no such track' });
  if (!RECORDS.includes(record)) return res.status(400).json({ error: 'record must be trk|fb' });
  if (!['User', 'Role'].includes(subjectKind)) {
    return res.status(400).json({ error: 'subject_kind must be User|Role' });
  }
  if (typeof subject !== 'string' || !subject || typeof policy !== 'string' || !policy) {
    return res.status(400).json({ error: 'subject and policy are required strings' });
  }
  db.prepare(
    `insert into policies (track_id, record, subject_kind, subject, policy, created_at, created_by)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, record, subjectKind, subject, policy, new Date().toISOString(), req.auth.sub);
  audit(req.auth.sub, 'POST policy', `${record}:${id}`, '200');
  res.status(201).json({ record: `${record}:${id}`, subject_kind: subjectKind, subject });
});

export default router;
