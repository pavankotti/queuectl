import Database from 'better-sqlite3';

export const db = new Database('queuectl.db');

// Enable WAL mode for high concurrency across processes
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

// Create tables and insert default configuration
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    run_at TEXT NOT NULL,
    worker_pid INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  INSERT OR IGNORE INTO config VALUES ('max-retries', '3');
  INSERT OR IGNORE INTO config VALUES ('backoff-base', '2');
  INSERT OR IGNORE INTO config VALUES ('stale-timeout-sec', '15');
  INSERT OR IGNORE INTO config VALUES ('workers_active', '1');
`);

// 1. Insert a new job into the queue
export function insertJob(data) {
  const now = new Date().toISOString();
  const id = data.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const maxRetries = data.max_retries || parseInt(getConfig('max-retries') || '3', 10);

  const query = db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, run_at, created_at, updated_at)
    VALUES (?, ?, 'pending', 0, ?, ?, ?, ?)
  `);
  query.run(id, data.command, maxRetries, now, now, now);

  return getJobById(id);
}

// 2. Atomic job claiming across OS processes
export function claimNextJob(workerPid) {
  const now = new Date().toISOString();
  const query = db.prepare(`
    UPDATE jobs
    SET state = 'processing', updated_at = ?, worker_pid = ?
    WHERE id = (
      SELECT id FROM jobs
      WHERE (state = 'pending' OR (state = 'failed' AND run_at <= ?))
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING *
  `);
  return query.get(now, workerPid, now) || null;
}

// 3. Update job state and fields
export function updateJob(id, state, updates = {}) {
  const now = new Date().toISOString();
  const attempts = updates.attempts !== undefined ? updates.attempts : null;
  const runAt = updates.run_at || now;

  const query = db.prepare(`
    UPDATE jobs
    SET state = ?, attempts = COALESCE(?, attempts), run_at = ?, worker_pid = ?, updated_at = ?
    WHERE id = ?
  `);
  query.run(state, attempts, runAt, updates.worker_pid ?? null, now, id);
}

// 4. Query jobs and status summary
export function getJobsByState(state) {
  return db.prepare(`SELECT * FROM jobs WHERE state = ? ORDER BY created_at ASC`).all(state);
}

export function getJobById(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) || null;
}

export function getJobCounts() {
  const rows = db.prepare(`SELECT state, COUNT(*) as count FROM jobs GROUP BY state`).all();
  const summary = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
  for (const r of rows) {
    summary[r.state] = r.count;
  }
  return summary;
}

// 5. Stale job crash recovery (< 60s rule)
export function recoverStaleJobs() {
  const timeoutSec = parseInt(getConfig('stale-timeout-sec') || '15', 10);
  const cutoff = new Date(Date.now() - timeoutSec * 1000).toISOString();
  const staleJobs = db.prepare(`SELECT * FROM jobs WHERE state = 'processing' AND updated_at < ?`).all(cutoff);

  for (const job of staleJobs) {
    const attempts = job.attempts + 1;
    const state = attempts >= job.max_retries ? 'dead' : 'failed';
    updateJob(job.id, state, { attempts, run_at: new Date().toISOString(), worker_pid: null });
  }
}

// 6. Configuration getters and setters
export function getConfig(key) {
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export function setConfig(key, value) {
  db.prepare(`INSERT OR REPLACE INTO config VALUES (?, ?)`).run(key, value);
}