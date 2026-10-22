// Audit log minh bạch nhưng không được chứa token, proof, policy bytes hay plaintext (mục 5.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity, json, authorRoles } from './helpers.mjs';

const owner = await identity({ realmRoles: authorRoles, username: 'owner' });
const reviewer = await identity({ realmRoles: ['ps-paper-p1-reader'], username: 'reviewer' });
const operator = await identity({ realmRoles: ['ps-operator'], approver: true, username: 'operator' });

const POLICY = 'cG9saWN5LWJ5dGVzLW11c3Qtbm90LWxlYWs=';
const FEEDBACK = 'ZmVlZGJhY2stY2lwaGVydGV4dC1tdXN0LW5vdC1sZWFr';

test('audit: tác giả và operator đọc được, người khác 403', async () => {
  assert.equal((await owner.fetch('/api/audit')).status, 200);
  assert.equal((await operator.fetch('/api/audit')).status, 200);
  assert.equal((await reviewer.fetch('/api/audit')).status, 403);
});

test('audit không chứa secret, nhưng có ghi cả lần bị từ chối', async () => {
  const token = await owner.token();
  await owner.fetch('/api/me', { token });
  await owner.fetch('/api/papers/p1/blob', {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: 'Y2lwaGVydGV4dA==',
  });
  await operator.fetch('/api/papers/p1/policies', {
    ...json({ record: 'doc', subject_kind: 'Role', subject: 'ps-paper-p1-reader', policy: POLICY }),
  });
  await reviewer.fetch('/api/papers/p1/feedback', { ...json({ ciphertext: FEEDBACK }) });
  await operator.fetch('/api/papers/p2/blob'); // bị 403
  await owner.fetch('/api/me', { scheme: 'none', proof: false }); // bị 401

  const { audit } = await (await owner.fetch('/api/audit')).json();
  const dump = JSON.stringify(audit);
  for (const secret of [token, POLICY, FEEDBACK, 'Y2lwaGVydGV4dA==']) {
    assert.ok(!dump.includes(secret), `audit leaked ${secret.slice(0, 16)}…`);
  }
  assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(dump), 'audit chứa một JWT');

  const results = audit.map((r) => r.result);
  assert.ok(results.includes('403'));
  assert.ok(results.includes('401'));
  assert.ok(audit.some((r) => r.action === 'POST policy' && r.target === 'doc:p1'));
});
