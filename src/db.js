const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.resolve(process.cwd(), '.queue');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'queue.sqlite');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','processing','completed','failed','dead')) DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      priority INTEGER NOT NULL DEFAULT 0,
      run_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      worker_id TEXT,
      last_error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state_runat ON jobs(state, run_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC, created_at);

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('stdout','stderr','info','error')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      stop_requested INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      heartbeat_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const defaults = [
    ['max-retries', '3'],
    ['backoff-base', '2'],
    ['timeout-ms', '60000']
  ];
  const insertCfg = db.prepare('INSERT OR IGNORE INTO config(key, value) VALUES(?, ?)');
  const tx = db.transaction(() => {
    for (const [k, v] of defaults) insertCfg.run(k, v);
  });
  tx();
}

migrate();

module.exports = {
  db,
};


