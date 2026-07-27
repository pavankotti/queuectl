import { exec } from 'child_process';
import { promisify } from 'util';
import pc from 'picocolors';
import { claimNextJob, updateJob, getConfig, setConfig, recoverStaleJobs } from './database.js';

const execAsync = promisify(exec);

export async function runWorkerLoop(workerId) {
  const pid = process.pid;
  const tag = `[Worker-${workerId}:${pid}]`;

  while (true) {
    // Check if worker stop command was issued from another terminal
    if (getConfig('workers_active') === '0') {
      console.log(pc.yellow(`${tag} Stop signal received. Exiting.`));
      break;
    }

    // Recover jobs left in processing by crashed workers
    try {
      recoverStaleJobs();
    } catch {
      // Ignore database locks during recovery
    }

    // Atomically claim the next job
    const job = claimNextJob(pid);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    console.log(pc.cyan(`${tag} Claimed job '${job.id}' (${job.attempts + 1}/${job.max_retries}): ${job.command}`));
    const startTime = Date.now();
    let success = false;

    try {
      await execAsync(job.command);
      success = true;
    } catch {
      success = false;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    if (success) {
      updateJob(job.id, 'completed', { worker_pid: null });
      console.log(pc.green(`${tag} ✓ Job '${job.id}' completed in ${duration}s`));
    } else {
      const attempts = job.attempts + 1;
      const backoffBase = parseFloat(getConfig('backoff-base') || '2');

      if (attempts >= job.max_retries) {
        updateJob(job.id, 'dead', { attempts, worker_pid: null });
        console.log(pc.red(`${tag} ✗ Job '${job.id}' failed permanently (${attempts}/${job.max_retries}). Moved to DLQ.`));
      } else {
        const delaySec = Math.pow(backoffBase, attempts);
        const nextRunAt = new Date(Date.now() + delaySec * 1000).toISOString();
        updateJob(job.id, 'failed', { attempts, run_at: nextRunAt, worker_pid: null });
        console.log(pc.yellow(`${tag} ⚠ Job '${job.id}' failed attempt ${attempts}/${job.max_retries}. Retrying in ${delaySec}s.`));
      }
    }
  }
}

export async function startWorkers(countStr = '1') {
  const count = parseInt(countStr, 10);
  setConfig('workers_active', '1');
  console.log(pc.bold(pc.green(`Starting ${count} worker process(es) in foreground (PID: ${process.pid})...`)));

  let stopping = false;
  const stopHandler = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(pc.yellow(`\nReceived ${signal}. Stopping workers after in-flight jobs finish...`));
    setConfig('workers_active', '0');
  };

  process.on('SIGINT', () => stopHandler('SIGINT'));
  process.on('SIGTERM', () => stopHandler('SIGTERM'));

  const workerLoops = Array.from({ length: count }, (_, i) => runWorkerLoop(i + 1));
  await Promise.all(workerLoops);
}
