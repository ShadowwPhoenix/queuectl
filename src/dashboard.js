const express = require('express');
const path = require('path');
const { db } = require('./db');
const { getConfig } = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  const states = ['pending', 'processing', 'completed', 'dead'];
  const counts = {};

  for (const s of states) {
    const row = db.prepare('SELECT COUNT(1) AS c FROM jobs WHERE state = ?').get(s);
    counts[s] = row.c;
  }

  const workers = db.prepare('SELECT * FROM workers ORDER BY started_at DESC').all();
  res.render('index', { counts, workers });
});

app.get('/jobs', (req, res) => {
  const state = req.query.state || '';
  let jobs;

  if (state) {
    jobs = db
      .prepare('SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC')
      .all(state);
  } else {
    jobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC').all();
  }

  res.render('jobs', { jobs, state });
});

app.get('/dlq', (req, res) => {
  const msg = req.query.msg || '';
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE state = 'dead' ORDER BY updated_at DESC")
    .all();

  res.render('dlq', { jobs, msg });
});

app.post('/dlq/retry/:id', (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const id = req.params.id;

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);

  if (job && job.state === 'dead') {
    db.prepare(`
      UPDATE jobs 
      SET state = 'pending',
          attempts = 0,
          last_error = NULL,
          run_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(now, now, id);

    return res.redirect('/dlq?msg=✅ Job requeued successfully!');
  }

  res.redirect('/dlq?msg=⚠️ Job not found or not in DLQ');
});

app.get('/config', (req, res) => {
  const cfg = db.prepare('SELECT key, value FROM config').all();
  res.render('config', { cfg });
});

app.use((req, res, next) => {
  res.setHeader('Refresh', '10');
  next();
});

app.listen(PORT, () => {
  console.log(`🖥️  Dashboard running at http://localhost:${PORT}`);
});
