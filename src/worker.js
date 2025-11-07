const { db } = require('./db');
const { getNumberConfig } = require('./config');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

const workerId = uuidv4();

try {
  db.prepare(`
    UPDATE jobs SET state='pending', worker_id=NULL
    WHERE state='processing'
  `).run();
} catch (e) {
  console.error('Startup cleanup failed:', e.message);
}

function upsertWorker(status) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO workers(id, pid, status, stop_requested, started_at, heartbeat_at)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE 
    SET status=excluded.status, heartbeat_at=excluded.heartbeat_at, pid=excluded.pid
  `).run(workerId, process.pid, status, 0, now, now);
}

function claimNextJob() {
  const now = Math.floor(Date.now() / 1000);
  const sel = db.prepare(`
    SELECT * FROM jobs
    WHERE state='pending' AND run_at <= ?
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(now);
  if (!sel) return null;

  const upd = db.prepare(`
    UPDATE jobs 
    SET state='processing', worker_id=?, updated_at=?, attempts=attempts+1 
    WHERE id=? AND state='pending'
  `);
  const res = upd.run(workerId, now, sel.id);

  if (res.changes === 1) {
    console.log(`⚙️  Worker picked job: ${sel.id} (priority ${sel.priority})`);
    return sel.id;
  }
  return null;
}

function writeLog(jobId, type, content) {
  db.prepare('INSERT INTO job_logs(job_id, type, content) VALUES(?,?,?)').run(jobId, type, content);
}

async function runJob(jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if (!job) return;

  const timeoutMs = getNumberConfig('timeout-ms', 60000);
  upsertWorker('running');
  const startTime = Date.now();

  console.log(
    `🚀 Starting job: ${job.id} | Command: "${job.command}" | Priority: ${job.priority} | Attempt: ${job.attempts}/${job.max_retries}`
  );

  return new Promise((resolve) => {
    const child = exec(job.command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const now = Math.floor(Date.now() / 1000);
      if (stdout) writeLog(jobId, 'stdout', stdout.toString());
      if (stderr) writeLog(jobId, 'stderr', stderr.toString());

      const current = db.prepare('SELECT attempts, max_retries FROM jobs WHERE id=?').get(jobId);
      const attempts = current?.attempts ?? 0;
      const maxRetries = current?.max_retries ?? 3;

      if (!error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        db.prepare(`
          UPDATE jobs 
          SET state='completed', updated_at=?, last_error=NULL 
          WHERE id=?
        `).run(now, jobId);
        console.log(`✅ Job ${jobId} completed in ${duration}s`);
        return resolve();
      }

      // Retry logic
      const base = getNumberConfig('backoff-base', 2);
      const delaySec = Math.pow(base, attempts);
      const nextRun = now + delaySec;
      const errorMsg = String(error.message || error);

      if (attempts >= maxRetries) {
        db.prepare(`
          UPDATE jobs 
          SET state='dead', attempts=?, last_error=?, run_at=?, updated_at=?, worker_id=NULL 
          WHERE id=?
        `).run(attempts, errorMsg, now, now, jobId);
        console.error(`💀 Job ${jobId} permanently failed after ${attempts} attempts. Moved to DLQ.`);
      } else {
        db.prepare(`
          UPDATE jobs 
          SET state='pending', attempts=?, last_error=?, run_at=?, updated_at=?, worker_id=NULL
          WHERE id=?
        `).run(attempts, errorMsg, nextRun, now, jobId);
        console.warn(`⚠️ Job ${jobId} failed (attempt ${attempts}), retrying in ${delaySec}s.`);
      }

      resolve();
    });
  });
}

async function mainLoop() {
  console.log(`👷 Worker ${workerId} started (PID ${process.pid})`);
  upsertWorker('idle');
  const beat = setInterval(() => upsertWorker('idle'), 5000);

  try {
    while (true) {
      const stopFlag = db.prepare('SELECT stop_requested FROM workers WHERE id=?').get(workerId);
      if (stopFlag && stopFlag.stop_requested) break;

      const jobId = claimNextJob();

      // 💤 If no job found, check if queue is empty
      if (!jobId) {
        const pendingCount = db.prepare("SELECT COUNT(1) AS c FROM jobs WHERE state='pending'").get().c;
        if (pendingCount === 0) {
          console.log("✨ No more jobs left. Worker exiting.");
          break; // ✅ Exit automatically when queue is empty
        }

        const nextJob = db.prepare(`
          SELECT run_at FROM jobs 
          WHERE state='pending' 
          ORDER BY run_at ASC 
          LIMIT 1
        `).get();

        const now = Math.floor(Date.now() / 1000);
        const waitMs = nextJob ? Math.max(500, (nextJob.run_at - now) * 1000) : 1000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }

      await runJob(jobId);

      const checkStop = db.prepare('SELECT stop_requested FROM workers WHERE id=?').get(workerId);
      if (checkStop && checkStop.stop_requested) break;
    }
  } finally {
    clearInterval(beat);
    db.prepare('DELETE FROM workers WHERE id=?').run(workerId);
    console.log(`🛑 Worker ${workerId} stopped gracefully.`);
  }
}

mainLoop().catch((err) => {
  console.error('❌ Worker error:', err);
  process.exit(1);
});
