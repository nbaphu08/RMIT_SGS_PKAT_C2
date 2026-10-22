import { Router } from 'express';
import { audit, db } from '../db.js';
import { requireApprover, requireRole } from '../auth.js';

const router = Router();

// Owner chỉ ĐỀ XUẤT chia sẻ; việc cấp quyền thật xảy ra ở QEA Approvals của tide-console.
router.post('/tracks/:id/shares', requireRole('us-owner'), (req, res) => {
  const { id } = req.params;
  if (!db.prepare(`select 1 from tracks where id = ?`).get(id)) {
    return res.status(404).json({ error: 'no such track' });
  }
  const { reviewer } = req.body ?? {};
  if (typeof reviewer !== 'string' || !reviewer) {
    return res.status(400).json({ error: 'reviewer must be a non-empty string' });
  }
  const { lastInsertRowid } = db
    .prepare(
      `insert into share_requests (track_id, reviewer, status, created_at) values (?, ?, 'requested', ?)`,
    )
    .run(id, reviewer, new Date().toISOString());
  audit(req.auth.sub, 'POST share', `trk:${id}`, '200');
  res.status(201).json({ id: Number(lastInsertRowid), track_id: id, reviewer, status: 'requested' });
});

// Chỉ để hiển thị: gắn id của change request trong tide-console. Không cấp quyền gì.
router.patch('/shares/:id', requireApprover, (req, res) => {
  const row = db.prepare(`select * from share_requests where id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'no such share request' });
  const { change_request_id: crId, status } = req.body ?? {};
  if (typeof crId !== 'string' || !crId) {
    return res.status(400).json({ error: 'change_request_id must be a non-empty string' });
  }
  db.prepare(`update share_requests set change_request_id = ?, status = ? where id = ?`).run(
    crId,
    status ?? 'pending',
    row.id,
  );
  audit(req.auth.sub, 'PATCH share', `share:${row.id}`, '200');
  res.json({ ...row, change_request_id: crId, status: status ?? 'pending' });
});

export default router;
