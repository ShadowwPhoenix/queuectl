const { db } = require('./db');
const { v4: uuidv4 } = require('uuid');
const { getNumberConfig } = require('./config');

async function enqueueJob(input) {
  const id = input.id || uuidv4();
  const now = Math.floor(Date.now() / 1000);

  const runAt = input.run_at
    ? Math.floor(new Date(input.run_at).getTime() / 1000)
    : now;

  const priority = Number.isFinite(input.priority) ? input.priority : 0;
  const defaultMax = getNumberConfig('max-retries', 3);
  const maxRetries = Number.isFinite(input.max_retries)
    ? input.max_retries
    : defaultMax;

  if (!input.command || typeof input.command !== 'string') {
    throw new Error('Job must include a string command');
  }

  const stmt = db.prepare(`
    INSERT INTO jobs (
      id, command, state, attempts, max_retries,
      priority, run_at, created_at, updated_at
    ) VALUES (?, ?, 'pending', 0, ?, ?, ?, ?, ?)
  `);

  stmt.run(id, input.command, maxRetries, priority, runAt, now, now);

  return { id };
}

async function listJobs(state) {
  if (state) {
    return db
      .prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC')
      .all(state);
  }
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
}

async function getStatus() {
  const states = ['pending', 'processing', 'completed', 'failed', 'dead'];
  const counts = {};

  for (const s of states) {
    const row = db.prepare('SELECT COUNT(1) AS c FROM jobs WHERE state = ?').get(s);
    counts[s] = row.c;
  }

  const workers = db
    .prepare('SELECT COUNT(1) AS c FROM workers WHERE stop_requested = 0')
    .get();

  return { jobs: counts, active_workers: workers.c };
}

async function dlqList() {
  return db
    .prepare("SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC")
    .all();
}

async function dlqRetry(jobId) {
  const now = Math.floor(Date.now() / 1000);
  const info = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);

  if (!info) throw new Error(`Job not found: ${jobId}`);
  if (info.state !== 'dead') throw new Error(`Job ${jobId} is not in DLQ (state=${info.state})`);

  db.prepare(`
    UPDATE jobs
    SET state = 'pending',
        attempts = 0,
        last_error = NULL,
        worker_id = NULL,
        updated_at = ?,
        run_at = ?
    WHERE id = ?
  `).run(now, now, jobId);

  console.log(`♻️ Job ${jobId} moved from DLQ to pending queue`);
}


module.exports = {
  enqueueJob,
  listJobs,
  getStatus,
  dlqList,
  dlqRetry,
};
