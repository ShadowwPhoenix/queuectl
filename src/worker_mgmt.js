const { spawn } = require('child_process');
const path = require('path');
const { db } = require('./db');

async function startWorkers(count, foreground = false) {
  const pids = [];
  for (let i = 0; i < count; i++) {
    const workerPath = path.join(__dirname, 'worker.js');

    if (foreground) {
      console.log(`\n🎯 Starting worker ${i + 1} in foreground...\n`);
      const child = spawn(process.execPath, [workerPath], { stdio: 'inherit' });
      await new Promise((resolve) => child.on('exit', resolve));
    } else {
      const child = spawn(process.execPath, [workerPath], {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
      pids.push(child.pid);
    }
  }
  return pids;
}


async function stopWorkers() {
  const res = db.prepare(`
    UPDATE workers 
    SET stop_requested = 1 
    WHERE stop_requested = 0
  `).run();
  return res.changes;
}

async function showWorkers() {
  return db
    .prepare(`
      SELECT id, pid, status, stop_requested, started_at, heartbeat_at 
      FROM workers 
      ORDER BY started_at DESC
    `)
    .all();
}

module.exports = { startWorkers, stopWorkers, showWorkers };
