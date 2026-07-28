# Architectural Decisions & Trade-offs — QueueCTL

This document details key architectural decisions, trade-offs, and design justifications for **QueueCTL**.

---

### 1. Atomic Job Claiming Across OS Processes
**Exact Line Reference**: `src/database.js` (Lines 44–58 in `claimNextJob`)

```sql
UPDATE jobs
SET state = 'processing', updated_at = ?, worker_pid = ?
WHERE id = (
  SELECT id FROM jobs
  WHERE (state = 'pending' OR (state = 'failed' AND run_at <= ?))
  ORDER BY created_at ASC
  LIMIT 1
)
RETURNING *
```

**Why it is atomic across separate OS processes**:
1. **SQLite Write Transactions**: SQLite in Write-Ahead Logging (`WAL`) mode serializes write transactions across all OS processes.
2. **Single SQL Statement**: The subquery `SELECT id ... LIMIT 1` is evaluated inside the single atomic `UPDATE ... RETURNING` statement.
3. **Database Lock**: When process A executes this statement, SQLite acquires an immediate write lock. Process B attempting to run the same update at the exact same instant is queued until Process A's statement completes.
4. No two workers can ever claim or execute the same job ID.

---

### 2. Worker SIGKILL Crash Recovery (Step-by-Step)
**Scenario**: A worker process executing a job receives `SIGKILL`.

**Step-by-Step Lifecycle**:
1. **At crash time**: The worker process dies instantly. No cleanup handlers run.
2. **Database State**: The job remains in state `'processing'` with `updated_at = <timestamp>`.
3. **Detection**: Every active worker process executes `recoverStaleJobs()` (`src/database.js`) on each polling tick.
4. **Stale Threshold**: Checks for any job where `state = 'processing'` and `updated_at < (now - stale_timeout_sec)`. Default `stale-timeout-sec` is **15 seconds**.
5. **State Transition**:
   - `attempts` is incremented by `1`.
   - If `attempts >= max_retries`, state moves to `'dead'` (DLQ).
   - Otherwise, state moves to `'failed'` with `run_at = now()`.
6. **Re-execution**: The recovered job becomes eligible again and is claimed by an active worker.

**Worst-case recovery delay**:
- **~15 seconds** (configurable via `queuectl config set stale-timeout-sec <sec>`). This satisfies the **< 60 seconds** requirement.

---

### 3. DLQ Retry & Attempt Count Reset Rationale
**Decision**: `queuectl dlq retry <id>` **resets `attempts` to 0** and sets `state` to `'pending'`.

**Why this is the right call**:
1. **Fresh Lifecycle**: Moving to DLQ signifies that the original attempt quota (`max_retries`) was exhausted. A manual retry after a fix gives the job a fresh retry budget.
2. **Exponential Backoff Reset**: If `attempts` were not reset, a retried job experiencing another transient failure would immediately trigger maximum backoff delay ($2^{\text{max\_retries}}$) or drop back into DLQ after a single failure.

---

### 4. Worker Stop (Cross-Process Signaling) Design & Rejected Alternatives

**Selected Design**: **Database State Flag (`workers_active` in SQLite `config` table)**.
- Running `queuectl worker stop` sets `workers_active = 0` in the database.
- Worker loops poll `workers_active` prior to claiming new jobs. Upon detecting `0`, workers complete their active job in-flight and exit cleanly.

**Rejected Alternatives**:
1. **OS PID Files / Signal Emission (`kill -SIGTERM <pid>`)**:
   - *Why rejected*: Storing PID files creates race conditions if processes crash without deleting PID files, or if PIDs are reassigned by the OS.
2. **Unix Control Sockets / IPC**:
   - *Why rejected*: Adds unnecessary socket management complexity and requires persistent listener threads inside workers.

---

### 5. Architectural Survival Analysis for Priority Queues

If job priorities (`high`, `medium`, `low`) were added:

**What survives UNCHANGED**:
1. **Database Schema & WAL Mode**: SQLite persistence, connections, busy timeouts, and config tables remain identical.
2. **Worker Shell Execution & Backoff Logic**: Process execution, backoff calculations ($2^{\text{attempts}}$), DLQ lifecycle, and signal handling remain 100% unchanged.

**What BREAKS / REQUIRES MODIFICATION**:
1. **Atomic Claim Subquery (`claimNextJob`)**:
   - Must be updated from `ORDER BY created_at ASC` to `ORDER BY priority DESC, created_at ASC`.
2. **CLI Enqueue Contract**:
   - `queuectl enqueue` input schema must accept an optional `"priority": number` field.
