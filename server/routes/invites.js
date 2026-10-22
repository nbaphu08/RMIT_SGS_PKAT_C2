import { Router } from 'express';
import { audit, db } from '../db.js';
import { requireApprover, requireRole } from '../auth.js';

const router = Router();

// Tác giả chỉ MỜI; việc cấp role thật xảy ra ở QEA Approvals (2/3) của tide-console.
router.post('/papers/:id/invites', requireRole('ps-author'), (req, res) => {
  const { id } = req.params;
  if (!db.prepare(`select 1 from papers where id = ?`).get(id)) {
    return res.status(404).json({ error: 'no such paper' });
  }
  const { reviewer } = req.body ?? {};
  if (typeof reviewer !== 'string' || !reviewer) {
    return res.status(400).json({ error: 'reviewer must be a non-empty string' });
  }
  const { lastInsertRowid } = db
    .prepare(
      `insert into invites (paper_id, reviewer, status, created_at) values (?, ?, 'requested', ?)`,
    )
    .run(id, reviewer, new Date().toISOString());
  audit(req.auth.sub, 'POST invite', `doc:${id}`, '200');
  res.status(201).json({ id: Number(lastInsertRowid), paper_id: id, reviewer, status: 'requested' });
});

// Chỉ để hiển thị: gắn id của change request trong tide-console. Không cấp quyền gì.
router.patch('/invites/:id', requireApprover, (req, res) => {
  const row = db.prepare(`select * from invites where id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'no such invite' });
  const { change_request_id: crId, status } = req.body ?? {};
  if (typeof crId !== 'string' || !crId) {
    return res.status(400).json({ error: 'change_request_id must be a non-empty string' });
  }
  db.prepare(`update invites set change_request_id = ?, status = ? where id = ?`).run(
    crId,
    status ?? 'pending',
    row.id,
  );
  audit(req.auth.sub, 'PATCH invite', `invite:${row.id}`, '200');
  res.json({ ...row, change_request_id: crId, status: status ?? 'pending' });
});

export default router;
