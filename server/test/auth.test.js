// T1 [MOCK]: requireAuth phải chặn mọi cách trình token không đúng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attackerKeys, identity, ownerRoles } from './helpers.mjs';

const owner = await identity({ realmRoles: ownerRoles, username: 'owner' });

test('token + proof hợp lệ → 200 và trả roles', async () => {
  const res = await owner.fetch('/api/me');
  assert.equal(res.status, 200);
  const me = await res.json();
  assert.equal(me.sub, owner.sub);
  assert.equal(me.tideuserkey, owner.tideuserkey);
  assert.deepEqual(me.roles, ownerRoles);
  assert.equal(me.is_approver, false);
});

test('thiếu Authorization → 401', async () => {
  const res = await owner.fetch('/api/me', { scheme: 'none', proof: false });
  assert.equal(res.status, 401);
});

test('token bound nhưng trình bằng Bearer → 401 (chặn replay token bị trộm)', async () => {
  const res = await owner.fetch('/api/me', { scheme: 'Bearer' });
  assert.equal(res.status, 401);
});

test('thiếu header DPoP → 401', async () => {
  const res = await owner.fetch('/api/me', { proof: false });
  assert.equal(res.status, 401);
});

test('token không có cnf.jkt → 401', async () => {
  const res = await owner.fetch('/api/me', { token: await owner.token({ unbound: true }) });
  assert.equal(res.status, 401);
});

test('sai chữ ký JWT → 401', async () => {
  const res = await owner.fetch('/api/me', {
    token: await owner.token({ key: attackerKeys.privateKey }),
  });
  assert.equal(res.status, 401);
});

test('token hết hạn → 401', async () => {
  const now = Math.floor(Date.now() / 1000);
  const res = await owner.fetch('/api/me', {
    token: await owner.token({ iat: now - 3600, exp: now - 60 }),
  });
  assert.equal(res.status, 401);
});

test('sai issuer hoặc sai azp → 401', async () => {
  for (const over of [{ iss: 'http://evil/realms/unreleased' }, { azp: 'other-client' }]) {
    const res = await owner.fetch('/api/me', { token: await owner.token(over) });
    assert.equal(res.status, 401);
  }
});

test('proof ký bằng khóa khác cnf.jkt → 401', async () => {
  const other = await identity({});
  const res = await owner.fetch('/api/me', {
    proofOver: { jwk: other.jwk, key: other.dpop.privateKey },
  });
  assert.equal(res.status, 401);
});

test('proof sai htm / htu / ath / typ → 401', async () => {
  const cases = [
    { htm: 'POST' },
    { htu: 'http://127.0.0.1:1/api/me' },
    { ath: 'deadbeef' },
    { typ: 'jwt' },
  ];
  for (const proofOver of cases) {
    const res = await owner.fetch('/api/me', { proofOver });
    assert.equal(res.status, 401, JSON.stringify(proofOver));
  }
});

test('dùng lại jti → 401 (replay)', async () => {
  const jti = 'fixed-jti-for-replay';
  assert.equal((await owner.fetch('/api/me', { proofOver: { jti } })).status, 200);
  assert.equal((await owner.fetch('/api/me', { proofOver: { jti } })).status, 401);
});
