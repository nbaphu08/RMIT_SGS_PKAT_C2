import { Router } from 'express';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BLOB_DIR, audit } from '../db.js';
import { requireRole } from '../auth.js';
import { blobPath } from './tracks.js';

const router = Router();

// Operator có toàn quyền trên storage — và màn Operator Console chứng minh như vậy vẫn không đủ.
router.get('/operator/storage', requireRole('us-operator'), (req, res) => {
  const files = readdirSync(BLOB_DIR).map((name) => {
    const head = readFileSync(join(BLOB_DIR, name)).subarray(0, 64);
    return {
      name,
      size: statSync(join(BLOB_DIR, name)).size,
      head_hex: head.toString('hex'),
      is_wav: head.subarray(0, 4).toString('latin1') === 'RIFF',
    };
  });
  audit(req.auth.sub, 'GET storage', null, '200');
  res.json({ dir: 'server/data/blobs', files });
});

router.get('/operator/blob/:id', requireRole('us-operator'), (req, res) => {
  const path = blobPath(req.params.id);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    return res.status(404).json({ error: 'not uploaded yet' });
  }
  audit(req.auth.sub, 'GET operator blob', `trk:${req.params.id}`, '200 (by design)');
  res.type('application/octet-stream').send(bytes);
});

export default router;
