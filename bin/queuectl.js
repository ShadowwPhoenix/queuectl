#!/usr/bin/env node
const { Command } = require('commander');
const { enqueueJob, listJobs, getStatus, dlqList, dlqRetry } = require('../src/queue');
const { startWorkers, stopWorkers, showWorkers } = require('../src/worker_mgmt');
const { setConfig, getConfig } = require('../src/config');

const program = new Command();

program
  .name('queuectl')
  .description('CLI-based background job queue system using SQLite')
  .version('1.0.0');

program
  .command('enqueue')
  .argument('[json]', 'JSON payload, or "-" to read from stdin')
  .description('Add a new job to the queue')
  .option('--id <id>', 'Job id (optional, otherwise auto-generated)')
  .option('--command <cmd>', 'Shell command to execute')
  .option('--priority <int>', 'Job priority (higher runs first)', parseInt)
  .option('--run-at <iso>', 'ISO timestamp to schedule execution')
  .option('--max-retries <int>', 'Override max retries for this job', parseInt)
  .action(async (json, options) => {
    async function readStdin() {
      return await new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => data += chunk);
        process.stdin.on('end', () => resolve(data));
      });
    }

    let payload = null;
    try {
      if (json === '-') {
        const raw = await readStdin();
        payload = JSON.parse(raw);
      } else if (json) {
        payload = JSON.parse(json);
      }
    } catch (e) {
      console.error('Invalid JSON payload');
      process.exit(1);
    }

    if (!payload) {
      payload = {};
      if (options.id) payload.id = options.id;
      if (options.command) payload.command = options.command;
    }

    try {
      const job = await enqueueJob({
        ...payload,
        priority: options.priority ?? payload.priority,
        run_at: options.runAt ?? payload.run_at ?? payload.runAt,
        max_retries: options.maxRetries ?? payload.max_retries ?? payload.maxRetries,
      });
      console.log('Enqueued job:', job.id);
    } catch (e) {
      console.error('Failed to enqueue job:', e.message);
      process.exit(1);
    }
  });

const workerCmd = program.command('worker').description('Manage workers');

workerCmd
  .command('start')
  .option('--count <int>', 'Number of workers to start', parseInt, 1)
  .option('--foreground', 'Run worker(s) in foreground and stream logs')
  .description('Start one or more worker processes')
  .action(async (opts) => {
    try {
      const pids = await startWorkers(opts.count || 1, opts.foreground);
      if (!opts.foreground) {
        console.log('Started background workers:', pids.join(', '));
      }
    } catch (e) {
      console.error('Failed to start workers:', e.message);
      process.exit(1);
    }
  });


workerCmd
  .command('stop')
  .description('Gracefully stop all running workers after current jobs')
  .action(async () => {
    try {
      const count = await stopWorkers();
      console.log(`Stop requested for ${count} worker(s).`);
    } catch (e) {
      console.error('Failed to stop workers:', e.message);
      process.exit(1);
    }
  });

workerCmd
  .command('list')
  .description('List all registered workers')
  .action(async () => {
    try {
      const workers = await showWorkers();
      console.log(JSON.stringify(workers, null, 2));
    } catch (e) {
      console.error('Failed to list workers:', e.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show summary of job states and active workers')
  .action(async () => {
    const s = await getStatus();
    console.log(JSON.stringify(s, null, 2));
  });

program
  .command('list')
  .option('--state <state>', 'Filter by state: pending|processing|completed|failed|dead')
  .description('List jobs, optionally filtered by state')
  .action(async (opts) => {
    const jobs = await listJobs(opts.state);
    console.log(JSON.stringify(jobs, null, 2));
  });

const dlqCmd = program.command('dlq').description('Dead letter queue operations');

dlqCmd
  .command('list')
  .description('List jobs in the dead letter queue')
  .action(async () => {
    const jobs = await dlqList();
    console.log(JSON.stringify(jobs, null, 2));
  });

dlqCmd
  .command('retry')
  .argument('<jobId>')
  .description('Retry a dead job by id')
  .action(async (jobId) => {
    try {
      await dlqRetry(jobId);
      console.log('Job requeued:', jobId);
    } catch (e) {
      console.error('Failed to retry job:', e.message);
      process.exit(1);
    }
  });

const cfgCmd = program.command('config').description('Manage configuration');

cfgCmd
  .command('set')
  .argument('<key>')
  .argument('<value>')
  .description('Set configuration value')
  .action(async (key, value) => {
    try {
      await setConfig(key, value);
      console.log('Config updated');
    } catch (e) {
      console.error('Failed to set config:', e.message);
      process.exit(1);
    }
  });

cfgCmd
  .command('get')
  .argument('[key]')
  .description('Get configuration value or all')
  .action(async (key) => {
    const cfg = await getConfig(key);
    console.log(JSON.stringify(cfg, null, 2));
  });

program
  .command('logs')
  .argument('<jobId>')
  .description('Show logs for a specific job')
  .action(async (jobId) => {
    const { db } = require('../src/db');
    const rows = db.prepare('SELECT type, content, created_at FROM job_logs WHERE job_id=? ORDER BY id ASC').all(jobId);
    if (!rows.length) {
      console.log(`No logs found for job: ${jobId}`);
      return;
    }
    for (const r of rows) {
      const ts = new Date(r.created_at * 1000).toISOString();
      console.log(`[${ts}] (${r.type}) ${r.content.trim()}`);
    }
  });

program
  .command('job')
  .argument('<jobId>')
  .description('Show job details and logs')
  .action(async (jobId) => {
    const { db } = require('../src/db');
    const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
    if (!job) {
      console.error(`Job not found: ${jobId}`);
      process.exit(1);
    }

    console.log(`\n🧱 Job: ${job.id}`);
    console.log(`Command: ${job.command}`);
    console.log(`State: ${job.state}`);
    console.log(`Attempts: ${job.attempts}/${job.max_retries}`);
    console.log(`Created: ${new Date(job.created_at * 1000).toISOString()}`);
    console.log(`Updated: ${new Date(job.updated_at * 1000).toISOString()}`);
    if (job.last_error) console.log(`Last error: ${job.last_error}`);
    console.log('\n📜 Logs:\n');

    const logs = db.prepare('SELECT type, content, created_at FROM job_logs WHERE job_id=? ORDER BY id ASC').all(jobId);
    if (!logs.length) {
      console.log('(No logs found)');
      return;
    }
    for (const log of logs) {
      const ts = new Date(log.created_at * 1000).toISOString();
      console.log(`[${ts}] (${log.type}) ${log.content.trim()}`);
    }
  });

program.parseAsync(process.argv);
