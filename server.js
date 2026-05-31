const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const { startShiftReminderLoop } = require('./services/pushNotifications');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path === '/sw.js') {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache');
  }
  if (req.path === '/manifest.webmanifest') {
    res.setHeader('Content-Type', 'application/manifest+json');
  }
  next();
});

app.use(session({
  store: new FileStore({
    path: process.env.SESSION_DIR || path.join(__dirname, 'sessions'),
    ttl: 28800,
    retries: 0
  }),
  secret: process.env.SESSION_SECRET || 'iiserb-shift-secret-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/community', require('./routes/community'));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/staff', (req, res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));
app.get('/worker-detail', (req, res) => res.sendFile(path.join(__dirname, 'public', 'worker-detail.html')));

app.listen(PORT, () => {
  console.log(`IISER Shift Management running at http://localhost:${PORT}`);
  startShiftReminderLoop();
});
