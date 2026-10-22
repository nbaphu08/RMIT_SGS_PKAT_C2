// requireAuth: JWT ký bởi Tide (jwk nhúng trong adapter, không remote JWKS) + DPoP proof.
// Server chỉ tin role có trong JWT, không tin DB (mục 3.4).
import { readFileSync } from 'node:fs';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { verifyDpop } from './verifyDpop.ts';
import { audit } from './db.js';

let cached = null;

function adapter() {
  if (!cached) {
    const raw =
      process.env.CLIENT_ADAPTER ??
      readFileSync(new URL('../public/tidecloak.json', import.meta.url), 'utf8');
    const cfg = JSON.parse(raw);
    if (!cfg.jwk) throw new Error('tidecloak.json thiếu jwk — xuất lại adapter khi đã bật IGA.');
    cached = { cfg, jwks: createLocalJWKSet(cfg.jwk) };
  }
  return cached;
}

/** Express req → dạng Fetch Request mà verifyDpop của pack mong đợi. */
function asFetchRequest(req) {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
  return {
    url: `${proto}://${host}${req.originalUrl}`,
    method: req.method,
    headers: { get: (name) => req.headers[name.toLowerCase()] ?? null },
  };
}

function rolesOf(payload) {
  const roles = [...(payload.realm_access?.roles ?? [])];
  for (const client of Object.values(payload.resource_access ?? {})) {
    roles.push(...(client?.roles ?? []));
  }
  return roles;
}

export async function requireAuth(req, res, next) {
  const authz = req.headers.authorization ?? '';
  const match = /^(?:DPoP|Bearer) (.+)$/i.exec(authz);
  if (!match) {
    audit('anonymous', `${req.method} ${req.path}`, null, '401');
    return res.status(401).json({ error: 'missing Authorization header' });
  }
  const token = match[1];

  // Thiếu public/tidecloak.json (A chưa xong) là lỗi cấu hình server, không phải 401.
  let cfg, jwks;
  try {
    ({ cfg, jwks } = adapter());
  } catch (e) {
    return res.status(503).json({ error: 'server not configured', reason: e.message });
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${cfg['auth-server-url'].replace(/\/+$/, '')}/realms/${cfg.realm}`,
    });
    if (payload.azp !== cfg.resource) throw new Error('token azp does not match client');
    // Bắt buộc: token sender-constrained phải kèm proof hợp lệ, nếu không thì binding là vô nghĩa.
    await verifyDpop(asFetchRequest(req), token, payload);

    req.auth = {
      sub: payload.sub,
      tideuserkey: payload.tideuserkey,
      username: payload.preferred_username,
      roles: rolesOf(payload),
      // Approver = tide-realm-admin trên client realm-management (mục 5.2).
      isApprover: (payload.resource_access?.['realm-management']?.roles ?? []).includes(
        'tide-realm-admin',
      ),
    };
    next();
  } catch (e) {
    audit('anonymous', `${req.method} ${req.path}`, null, '401');
    res.status(401).json({ error: 'unauthorized', reason: e.message });
  }
}

export function deny(req, res, reason) {
  audit(req.auth.sub, `${req.method} ${req.path}`, reason, '403');
  res.status(403).json({ error: 'forbidden', reason });
}

export function requireRole(role) {
  return (req, res, next) =>
    req.auth.roles.includes(role) ? next() : deny(req, res, `missing role ${role}`);
}

export function requireApprover(req, res, next) {
  return req.auth.isApprover ? next() : deny(req, res, 'missing tide-realm-admin');
}

export const isAuthor = (req) => req.auth.roles.includes('ps-author');
export const isReaderOf = (req, paperId) => req.auth.roles.includes(`ps-paper-${paperId}-reader`);
