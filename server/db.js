// SQLite + storage cho Unreleased Studio. DB và blob chỉ chứa ciphertext (T14).
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
  create table if not exists projects (
    id   text primary key,
    name text not null
  );
  create table if not exists tracks (
    id         text primary key,
    project_id text not null,
    title      text not null,
    blob_size  integer,
    updated_at text
  );
  -- policy đã ký (bytes base64). Subject 'User' = tideuserkey, 'Role' = tên role.
  create table if not exists policies (
    id           integer primary key autoincrement,
    track_id     text not null,
    record       text not null,        -- 'trk' | 'fb'
    subject_kind text not null,        -- 'User' | 'Role'
    subject      text not null,
    policy       text not null,
    created_at   text not null,
    created_by   text not null
  );
  create table if not exists feedback (
    id         integer primary key autoincrement,
    track_id   text not null,
    author_sub text not null,
    ciphertext text not null,
    created_at text not null
  );
  create table if not exists share_requests (
    id                integer primary key autoincrement,
    track_id          text not null,
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

// Seed cố định theo mục 3.1: 1 project, 3 track.
const SEED_TRACKS = [
  ['t1', 'Midnight Demo (v3)'],
  ['t2', 'Untitled Hook'],
  ['t3', 'B-side Sketch'],
];
db.prepare(`insert or ignore into projects (id, name) values (?, ?)`).run('p1', 'Unreleased Studio');
const insertTrack = db.prepare(
  `insert or ignore into tracks (id, project_id, title) values (?, 'p1', ?)`,
);
for (const [id, title] of SEED_TRACKS) insertTrack.run(id, title);

export const TRACK_IDS = SEED_TRACKS.map(([id]) => id);

/** Audit: chỉ ghi ai làm gì với cái gì, không ghi token/proof/policy/plaintext (mục 5.2). */
export function audit(actor, action, target, result) {
  db.prepare(`insert into audit (ts, actor, action, target, result) values (?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), actor, action, target ?? null, result);
}
