// base64.js — chuyển đổi bytes ↔ base64, DÙNG CHUNG cho src/lib/relationship.js (đường thật) và
// src/lib/mock/ork.js (đường mô phỏng).
//
// Chia khối 32 KB là BẮT BUỘC: `String.fromCharCode(...bytes)` với một PDF ~1,7 MB ném
// RangeError "Maximum call stack size exceeded" (đo 2026-10-22, chặn ngay bước đầu demo).

const CHUNK = 0x8000;

export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
