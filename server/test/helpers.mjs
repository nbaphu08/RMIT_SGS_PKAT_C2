// Hạ tầng test [MOCK]: JWT EdDSA tự sinh + DPoP proof ES256 thật.
// Chỉ chứng minh logic authz của chúng ta, KHÔNG chứng minh tích hợp Tide (mục 10).
import { mkdtempSync } from 'node:fs';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT, calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';

const REALM = 'unreleased';
const AUTH_SERVER = 'http://localhost:8080';
const CLIENT = 'unreleased-client';

export const realmKeys = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
export const attackerKeys = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
const realmJwk = { ...(await exportJWK(realmKeys.publicKey)), kid: 'test-realm', alg: 'EdDSA', use: 'sig' };

process.env.US_DATA_DIR = mkdtempSync(join(tmpdir(), 'unreleased-test-'));
process.env.CLIENT_ADAPTER = JSON.stringify({
  realm: REALM,
  'auth-server-url': AUTH_SERVER,
  resource: CLIENT,
  jwk: { keys: [realmJwk] },
});

// Import động: phải đặt US_DATA_DIR / CLIENT_ADAPTER xong rồi mới nạp db.js và app.
const { app } = await import('../index.js');
export const { db, BLOB_DIR } = await import('../db.js');

const server = app.listen(0);
await once(server, 'listening');
server.unref();
export const baseUrl = `http://127.0.0.1:${server.address().port}`;

const APPROVER = { 'realm-management': { roles: ['tide-realm-admin'] } };
export const ownerRoles = ['_tide_encryptor', '_tide_decryptor', 'us-owner'];

/** Một danh tính: giữ khóa DPoP riêng, tự mint token và tự ký proof cho mỗi request. */
export async function identity({ realmRoles = [], approver = false, username = 'user' } = {}) {
  const dpop = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(dpop.publicKey);
  const id = {
    sub: randomUUID(),
    tideuserkey: randomUUID(),
    username,
    realmRoles,
    clientRoles: approver ? APPROVER : {},
    dpop,
    jwk,
    jkt: await calculateJwkThumbprint(jwk, 'sha256'),
  };
  id.token = (over) => mint(id, over);
  id.fetch = (path, init) => authedFetch(id, path, init);
  return id;
}

export function mint(id, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    azp: over.azp ?? CLIENT,
    preferred_username: id.username,
    tideuserkey: id.tideuserkey,
    realm_access: { roles: id.realmRoles },
    resource_access: id.clientRoles,
    ...(over.unbound ? {} : { cnf: { jkt: id.jkt } }),
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: realmJwk.kid })
    .setIssuer(over.iss ?? `${AUTH_SERVER}/realms/${REALM}`)
    .setSubject(id.sub)
    .setIssuedAt(over.iat ?? now)
    .setExpirationTime(over.exp ?? now + 600)
    .sign(over.key ?? realmKeys.privateKey);
}

export async function dpopProof(id, method, url, token, over = {}) {
  const ath = Buffer.from(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
  ).toString('base64url');
  const u = new URL(url);
  return new SignJWT({
    jti: over.jti ?? randomUUID(),
    htm: over.htm ?? method,
    htu: over.htu ?? `${u.origin}${u.pathname}`,
    ath: over.ath ?? ath,
  })
    .setProtectedHeader({ alg: 'ES256', typ: over.typ ?? 'dpop+jwt', jwk: over.jwk ?? id.jwk })
    .setIssuedAt(over.iat ?? Math.floor(Date.now() / 1000))
    .sign(over.key ?? id.dpop.privateKey);
}

/**
 * init ngoài các tùy chọn của fetch còn nhận:
 *   token (dùng token cho sẵn), scheme ('Bearer' | 'none'), proof (false = không gửi), proofOver.
 */
export async function authedFetch(id, path, init = {}) {
  const { token: given, scheme = 'DPoP', proof = true, proofOver, ...rest } = init;
  const url = baseUrl + path;
  const method = rest.method ?? 'GET';
  const token = given ?? (await mint(id));
  const headers = { ...rest.headers };
  if (scheme !== 'none') headers.authorization = `${scheme} ${token}`;
  if (proof) headers.dpop = await dpopProof(id, method, url, token, proofOver);
  return fetch(url, { ...rest, headers });
}

export const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
