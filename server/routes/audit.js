import { Router } from 'express';
import { db } from '../db.js';
import { deny, isAuthor } from '../auth.js';

const router = Router();

router.get('/audit', (req, res) => {
  if (!isAuthor(req) && !req.auth.roles.includes('ps-operator')) {
    return deny(req, res, 'missing role ps-author or ps-operator');
  }
  const rows = db
    .prepare(`select id, ts, actor, action, target, result from audit order by id desc limit 200`)
    .all();
  res.json({ audit: rows });
});

export default router;
