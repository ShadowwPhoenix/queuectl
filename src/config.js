const { db } = require('./db');

function normalizeKey(key) {
  const map = {
    'max-retries': 'max-retries',
    'max_retries': 'max-retries',
    'backoff-base': 'backoff-base',
    'backoff_base': 'backoff-base',
    'timeout-ms': 'timeout-ms',
    'timeout_ms': 'timeout-ms',
    'stop-all-workers': 'stop-all-workers'
  };
  return map[key] || key;
}

async function setConfig(key, value) {
  const k = normalizeKey(String(key));
  db.prepare('INSERT INTO config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(value));
}

async function getConfig(key) {
  if (key) {
    const k = normalizeKey(String(key));
    const row = db.prepare('SELECT value FROM config WHERE key=?').get(k);
    return row ? row.value : null;
  }
  const all = db.prepare('SELECT key, value FROM config').all();
  const out = {};
  for (const r of all) out[r.key] = r.value;
  return out;
}

function getNumberConfig(key, fallback) {
  const v = db.prepare('SELECT value FROM config WHERE key=?').get(key);
  if (!v) return fallback;
  const num = Number(v.value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  setConfig,
  getConfig,
  getNumberConfig,
};


