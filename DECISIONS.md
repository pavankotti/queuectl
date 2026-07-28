# QueueCTL — Architectural Design Decisions

This document outlines the core system design, concurrency guarantees, and architectural trade-offs powering **QueueCTL**.

---

## 🏛️ System Architecture Overview

QueueCTL manages background job execution across independent OS processes and terminal sessions using a single, unified SQLite database (`queuectl.db`) running in Write-Ahead Logging (`WAL`) mode.

```text
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│     Terminal A (Process 1)      │        │     Terminal B (Process 2)      │
│  queuectl worker start --count 2 │        │  queuectl worker start --count 1 │
└────────────────┬────────────────┘        └────────────────┬────────────────┘
                 │                                          │
                 ├── Worker 1 (PID 101)                     └── Worker 1 (PID 201)
                 └── Worker 2 (PID 102)                            │
                         │                                         │
                         └──────────────────┬──────────────────────┘
                                            │
                                  SQLite WAL Database
                                    (queuectl.db)
```

Workers operate in foreground event loops. Cross-terminal worker coordination and state synchronization take place directly through transactional SQLite queries.

---

## 💡 Core Design Questions & Trade-offs

### Q1 — How is Atomic Job Claiming Guaranteed Across Processes?
**Exact Code Reference**: `src/database.js` (`claimNextJob`)

```javascript
export function claimNextJob(workerPid) {
  const now = new Date().toISOString();
  return db.prepare(`
    UPDATE jobs
    SET state = 'processing', updated_at = ?, worker_pid = ?
    WHERE id = (
      SELECT id FROM jobs
      WHERE (state = 'pending' OR (state = 'failed' AND run_at <= ?))
      ORDER BY created_at ASC
      LIMIT 1
    )
    RETURNING *
  `).get(now, workerPid, now) || null;
}
```

#### Why This Operation is Atomic:
1. **Single Statement Update**: The job selection (`SELECT ... LIMIT 1`) occurs directly within the `UPDATE ... RETURNING` statement.
2. **SQLite Write Locks**: SQLite in WAL mode serializes write transactions across all OS processes. When multiple workers execute `claimNextJob` concurrently, SQLite processes them sequentially.
3. **State Isolation**: The first worker statement changes the candidate row's state from `pending` to `processing`. The subsequent worker statement evaluated a millisecond later sees the row as `processing` and skips it, returning `null`.
4. **No Double-Claiming**: A separate `SELECT` followed by an `UPDATE` introduces a race window where two processes read the same `pending` job. A single `UPDATE RETURNING` query eliminates the race condition entirely.

---

### Q2 — What Happens When a Worker Process Receives SIGKILL (`kill -9`) Mid-Execution?
When an OS process receives `SIGKILL`, it terminates immediately without firing JavaScript signal handlers or `finally` blocks.

#### Step-by-Step Crash Lifecycle:
1. **Mid-Job Crash**: A worker process claims a job and calls `execAsync(job.command)`. The job state in SQLite is set to `state = 'processing'` with `updated_at = T0`.
2. **Abrupt Termination**: `SIGKILL` kills the worker. The database row remains locked at `processing` with `updated_at = T0`.
3. **Detection via Stale Watchdog**: Active worker loops periodically execute `recoverStaleJobs()`:
   ```sql
   SELECT * FROM jobs WHERE state = 'processing' AND updated_at < ? (cutoff = now - stale_timeout_sec)
   ```
4. **State Reset**: Any job stuck in `processing` beyond the configured timeout (default **15 seconds**) is marked as `failed` (or `dead` if attempts exceed `max_retries`).
5. **Re-Execution**: On the next loop tick, an active worker claims the recovered job.

#### Recovery Time Bound:
- **Maximum Recovery Delay**: **~15 seconds** (controlled by `stale-timeout-sec`). This satisfies the requirement for sub-60-second crash recovery.

---

### Q3 — Why Does DLQ Retry Reset the Attempt Count?
When a job is retried using `queuectl dlq retry <id>`, `attempts` is explicitly **reset to 0**.

#### Design Rationale:
- **Restoring Full Retry Lifecycle**: A job enters the Dead Letter Queue (`dead`) because it exhausted its original attempt quota (`max_retries`). Manual intervention (such as fixing an environment variable, network issue, or bug) resolves the root cause. Resetting `attempts` to 0 allows the fixed job a full retry budget ($2^1=2\text{s}$, $2^2=4\text{s}$, etc.) rather than failing immediately on a single attempt.

---

### Q4 — How Does `queuectl worker stop` Signal Workers Across Terminals?

#### Selected Architecture: Shared Database State Flag
- `queuectl worker stop` executes `setConfig('workers_active', '0')` in the SQLite `config` table.
- Worker loops inspect `getConfig('workers_active')` prior to claiming each job.
- When set to `'0'`, workers complete any active in-flight execution and exit cleanly.

#### Trade-off & Evaluation of Alternatives:
| Strategy | Pros | Cons / Why Rejected |
|---|---|---|
| **Database Config Flag (Chosen)** | Zero external dependencies, robust across terminals, no stale PID files. | In-flight jobs finish before workers poll the flag. |
| **File-Based PID Registry (`workers.json`)** | Direct `SIGTERM` OS signals to PIDs. | Stale PID files if workers crash; risks signaling reassigned OS PIDs. |
| **Unix Control Sockets / IPC** | Instant message delivery. | High code complexity; requires persistent socket listeners inside workers. |

---

### Q5 — Impact Analysis: Adding Job Priorities

If job priorities (`high`, `medium`, `low`) were introduced to QueueCTL:

#### Components Surviving Unchanged:
- **Worker Execution Loop**: Runs shell commands regardless of priority level.
- **Graceful Shutdown Mechanism**: Signal handling and `workers_active` flag operate independently of priority.
- **Exponential Backoff & DLQ**: Delay math ($2^{\text{attempts}}$) remains unchanged.

#### Components Requiring Modification:
1. **Claim Query (`claimNextJob`)**: The subquery must change from `ORDER BY created_at ASC` to `ORDER BY priority DESC, created_at ASC`.
2. **CLI Schema**: Enqueue input schema must be updated to accept an optional `"priority": number` argument.
3. **Starvation Protection**: Continuous high-priority jobs can starve low-priority tasks; a weighted scheduling algorithm would be required for fair queue drain.
