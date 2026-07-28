#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { showBanner } from './ui.js';
import { insertJob, getJobsByState, getJobCounts, updateJob, setConfig } from './database.js';
import { startWorkers } from './worker.js';

const program = new Command();

program
  .name('queuectl')
  .description('CLI-based background job queue system')
  .version('1.0.0');

// Show ASCII gradient header unless --json flag is passed
if (!process.argv.includes('--json')) {
  showBanner();
}

// 1. Enqueue Job Command
program
  .command('enqueue <json-payload>')
  .description('Add a new job to the queue')
  .action((payload) => {
    const data = JSON.parse(payload);
    const job = insertJob(data);
    console.log(pc.green(`✓ Successfully enqueued job '${job.id}'`));
  });

// 2. Worker Subcommands
const workerCmd = program.command('worker').description('Worker process management');

workerCmd
  .command('start')
  .option('-c, --count <number>', 'Number of workers', '1')
  .action(async (opts) => {
    await startWorkers(opts.count);
  });

workerCmd
  .command('stop')
  .action(() => {
    setConfig('workers_active', '0');
    console.log(pc.yellow('✓ Signal sent to stop all workers cleanly.'));
  });

// 3. System Status Command
program
  .command('status')
  .action(() => {
    const counts = getJobCounts();
    console.log(pc.bold(' QueueCTL Status Summary'));
    console.log(pc.dim('---------------------------------------'));
    for (const [state, count] of Object.entries(counts)) {
      console.log(`  ${state}: ${count}`);
    }
    console.log(pc.dim('---------------------------------------'));
  });

// 4. List Jobs Command
program
  .command('list')
  .requiredOption('-s, --state <state>', 'Filter state')
  .option('--json', 'JSON output')
  .action((opts) => {
    const jobs = getJobsByState(opts.state);
    if (opts.json) {
      process.stdout.write(JSON.stringify(jobs, null, 2) + '\n');
      return;
    }
    console.log(pc.bold(`Jobs in '${opts.state}' (${jobs.length}):`));
    jobs.forEach((j) => console.log(`  • [${j.id}] ${j.command} (${j.attempts}/${j.max_retries})`));
  });

// 5. DLQ Management Commands
const dlqCmd = program.command('dlq').description('DLQ management');

dlqCmd
  .command('list')
  .action(() => {
    const dead = getJobsByState('dead');
    console.log(pc.bold(`☠ DLQ (${dead.length}):`));
    dead.forEach((j) => console.log(`  • [${j.id}] ${j.command}`));
  });

dlqCmd
  .command('retry <id>')
  .action((id) => {
    updateJob(id, 'pending', { attempts: 0, run_at: new Date().toISOString(), worker_pid: null });
    console.log(pc.green(`✓ Job '${id}' re-enqueued from DLQ.`));
  });

// 6. Configuration Management Commands
const configCmd = program.command('config').description('Config management');

configCmd
  .command('set <key> <value>')
  .action((key, value) => {
    setConfig(key, value);
    console.log(pc.green(`✓ Config updated: ${key} = ${value}`));
  });

program.parse(process.argv);
