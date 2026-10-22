import { Router } from 'express';
import { db } from '../db.js';
import { deny, isOwner } from '../auth.js';

const router = Router();

router.get('/audit', (req, res) => {
  if (!isOwner(req) && !req.auth.roles.includes('us-operator')) {
    return deny(req, res, 'missing role us-owner or us-operator');
  }
  const rows = db
    .prepare(`select id, ts, actor, action, target, result from audit order by id desc limit 200`)
    .all();
  res.json({ audit: rows });
});

export default router;
