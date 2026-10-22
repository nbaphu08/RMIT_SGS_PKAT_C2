// SQLite + storage cho Papersec. DB và blob chỉ chứa ciphertext (T14).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Test chạy trên thư mục tạm; mặc định là server/data (gitignored).
export const DATA_DIR = process.env.US_DATA_DIR ?? new URL('./data/', import.meta.url).pathname;
export const BLOB_DIR = join(DATA_DIR, 'blobs');

mkdirSync(BLOB_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'app.db'));

db.exec(`
  create table if not exists users (
    tideuserkey text primary key,
    sub         text not null,
    username    text,
    first_seen  text not null
  );
  create table if not exists papers (
    id           text primary key,
    code_title   text not null,
    review_until text,
    blob_size    integer,
    updated_at   text
  );
  -- policy đã ký (bytes base64). Subject 'User' = tideuserkey, 'Role' = tên role.
  create table if not exists policies (
    id           integer primary key autoincrement,
    paper_id     text not null,
    record       text not null,        -- 'doc' | 'fb'
    subject_kind text not null,        -- 'User' | 'Role'
    subject      text not null,
    policy       text not null,
    created_at   text not null,
    created_by   text not null
  );
  create table if not exists feedback (
    id         integer primary key autoincrement,
    paper_id   text not null,
    author_sub text not null,
    ciphertext text not null,
    created_at text not null
  );
  create table if not exists invites (
    id                integer primary key autoincrement,
    paper_id          text not null,
    reviewer          text not null,
    status            text not null,
    change_request_id text,
    created_at        text not null
  );
  create table if not exists audit (
    id     integer primary key autoincrement,
    ts     text not null,
    actor  text not null,
    action text not null,
    target text,
    result text not null
  );
`);

const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

// Seed cố định theo mục 3.1: p1 còn hạn, p2 chưa chia sẻ, p3 đã hết hạn.
const SEED_PAPERS = [
  ['p1', 'Low-Resource ASR for Vietnamese Dialects', days(7)],
  ['p2', 'Federated Learning on Hospital Imaging', null],
  ['p3', 'Quantum-Safe Voting Protocol', days(-1)],
];
const insertPaper = db.prepare(
  `insert or ignore into papers (id, code_title, review_until) values (?, ?, ?)`,
);
for (const [id, title, until] of SEED_PAPERS) insertPaper.run(id, title, until);

export const PAPER_IDS = SEED_PAPERS.map(([id]) => id);

/** Audit: chỉ ghi ai làm gì với cái gì, không ghi token/proof/policy/plaintext (mục 5.2). */
export function audit(actor, action, target, result) {
  db.prepare(`insert into audit (ts, actor, action, target, result) values (?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), actor, action, target ?? null, result);
}
