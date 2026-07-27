import Database from 'better-sqlite3';

export const db = new Database('queuectl.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, command TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3, run_at TEXT NOT NULL,
    worker_pid INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT OR IGNORE INTO config VALUES ('max-retries', '3'), ('backoff-base', '2'), ('stale-timeout-sec', '15'), ('workers_active', '1');
`);

export function insertJob(data) {
  const now = new Date().toISOString();
  const id = data.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const maxRetries = data.max_retries || parseInt(getConfig('max-retries') || '3', 10);
  db.prepare(`INSERT INTO jobs (id, command, state, attempts, max_retries, run_at, created_at, updated_at) VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)`)
    .run(id, data.command, maxRetries, now, now, now);
  return getJobById(id);
}

export function claimNextJob(pid) {
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE jobs SET state = 'processing', updated_at = ?, worker_pid = ?
    WHERE id = (
      SELECT id FROM jobs WHERE (state = 'pending' OR (state = 'failed' AND run_at <= ?))
      ORDER BY created_at ASC LIMIT 1
    ) RETURNING *
  `).get(now, pid, now);
}

export function updateJob(id, state, updates = {}) {
  const now = new Date().toISOString();
  const attempts = updates.attempts !== undefined ? updates.attempts : null;
  const runAt = updates.run_at || now;
  db.prepare(`UPDATE jobs SET state = ?, attempts = COALESCE(?, attempts), run_at = ?, worker_pid = ?, updated_at = ? WHERE id = ?`)
    .run(state, attempts, runAt, updates.worker_pid ?? null, now, id);
}

export function getJobsByState(state) {
  return db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC`).all(state); 
}

export function getJobById(id) { 
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) || null; 
}

export function getJobCounts() {
  const rows = db.prepare(`SELECT state, COUNT(*) as count FROM jobs GROUP BY state`).all();
  const summary = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
  for (const r of rows) summary[r.state] = r.count;
  return summary;
}

export function getConfig(k) { 
  return db.prepare(`SELECT value FROM config WHERE key = ?`).get(k)?.value || null; 
}

export function setConfig(k, v) { 
  db.prepare(`INSERT OR REPLACE INTO config VALUES (?, ?)`).run(k, v); 
}