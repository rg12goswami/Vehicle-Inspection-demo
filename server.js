require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const inspectionRoutes = require('./routes/inspections');
const { readData } = require('./utils/jsonStore');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const REPORTS_DIR = path.join(ROOT, 'reports');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(REPORTS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(session({
  name: 'vehicle-demo.sid',
  secret: process.env.SESSION_SECRET || 'local-demo-secret-change-before-sharing',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/status', (_req, res) => {
  try {
    const data = readData();
    res.json({ ok: true, inspections: data.inspections.length, mode: 'local-demo' });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Could not read local data file.' });
  }
});

app.use('/api', inspectionRoutes);

app.get('/upload/:token', (req, res) => {
  const token = String(req.params.token || '');
  const found = readData().inspections.find((i) => i.uploadToken === token);
  if (!found) return res.status(404).send('<!doctype html><html><body style="font-family:Arial;padding:2rem"><h2>Invalid upload link</h2><p>Please ask the admin for a new link.</p></body></html>');
  res.sendFile(path.join(ROOT, 'public', 'upload.html'));
});

app.get('/media/:token/:mediaId', (req, res) => {
  const data = readData();
  const inspection = data.inspections.find((i) => i.uploadToken === req.params.token);
  if (!inspection) return res.status(404).send('Invalid or expired link.');
  const media = (inspection.media || []).find((m) => m.id === req.params.mediaId);
  if (!media) return res.status(404).send('Media not found.');
  const filePath = path.resolve(UPLOADS_DIR, inspection.id, media.filename);
  if (!filePath.startsWith(path.resolve(UPLOADS_DIR, inspection.id) + path.sep) || !fs.existsSync(filePath)) {
    return res.status(404).send('File not found.');
  }
  res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline; filename="' + path.basename(media.filename).replace(/"/g, '') + '"');
  fs.createReadStream(filePath).pipe(res);
});

app.use((err, _req, res, _next) => {
  console.error(err && err.message ? err.message : err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Unexpected server error. Check the terminal for details.' });
});

app.listen(PORT, () => {
  console.log(`Vehicle Inspection Portal running at http://localhost:${PORT}`);
  console.log('Admin page: http://localhost:' + PORT + '/admin.html');
  if (!process.env.ADMIN_PASSWORD) console.log('Demo admin password: demo123 (set ADMIN_PASSWORD in .env before sharing a public link)');
});
