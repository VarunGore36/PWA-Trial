const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const BUNDLED_DATA_DIR = path.join(__dirname, 'data');
const DATA_DIR = process.env.DATA_DIR || BUNDLED_DATA_DIR;
const DB_PATH = path.join(DATA_DIR, 'database.json');
const TEMP_ROSTER_PATH = path.join(__dirname, 'AutoRoster from May to June - Sheet1.tsv');
const IST_OFFSET_MINUTES = 330;
const SHIFT_REMINDER_LEAD_MINUTES = 60;
const CONFIRMABLE_SHIFTS = ['A', 'B', 'C', 'G'];
const SHIFT_STARTS = {
  A: { label: 'Morning', time: '06:00' },
  B: { label: 'Noon', time: '14:00' },
  C: { label: 'Evening', time: '22:00' },
  G: { label: 'General', time: '09:00' }
};
const DECLINE_REPLACEMENT_SHIFTS = {
  A: 'N_A',
  B: 'N_B',
  C: 'N_C'
};

const GATE_COORDS = {
  latitude: 23.2835,
  longitude: 77.2773,
  radiusMeters: 50
};

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isWithinPreConfirmWindow(date, shift) {
  const startMs = shiftStartUtcMs(date, shift);
  if (!startMs) return false;
  const now = Date.now();
  const windowStart = startMs - SHIFT_REMINDER_LEAD_MINUTES * 60 * 1000;
  return now >= windowStart && now < startMs;
}

function getGateConfig() {
  return { ...GATE_COORDS };
}

function isConfirmableShift(shift) {
  return CONFIRMABLE_SHIFTS.includes(String(shift || '').toUpperCase());
}

function istDateString(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10);
}

function shiftStartUtcMs(date, shift) {
  const definition = SHIFT_STARTS[String(shift || '').toUpperCase()];
  if (!definition) return null;
  return Date.parse(`${date}T${definition.time}:00:00+05:30`);
}

function shiftDisplayName(shift) {
  const normalized = String(shift || '').toUpperCase();
  const definition = SHIFT_STARTS[normalized];
  return definition ? `${definition.label} (${normalized})` : normalized;
}

function normalizeName(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeShiftForCounts(shift) {
  const normalized = String(shift || '').toUpperCase();
  if (['N_A', 'N_B', 'N_C'].includes(normalized)) return 'N';
  return normalized;
}

function parseTemporaryRosterDate(value) {
  const match = String(value || '').trim().match(/^(May|June)\s+(\d{1,2})$/i);
  if (!match) return null;

  const month = match[1].toLowerCase() === 'may' ? '05' : '06';
  const day = String(Number(match[2])).padStart(2, '0');
  return `2026-${month}-${day}`;
}

function readTemporaryRosterSchedules(db) {
  if (!fs.existsSync(TEMP_ROSTER_PATH)) return [];

  const rows = fs.readFileSync(TEMP_ROSTER_PATH, 'utf8')
    .trimEnd()
    .split(/\r?\n/)
    .map(line => line.split('\t'));

  if (rows.length < 3) return [];

  const dateColumns = rows[1]
    .map((value, index) => ({ index, date: parseTemporaryRosterDate(value) }))
    .filter(column => column.date);

  const staffByName = new Map(
    db.users
      .filter(user => user.role === 'staff')
      .map(user => [normalizeName(user.name), user])
  );

  const schedules = [];
  rows.slice(2).forEach(row => {
    const user = staffByName.get(normalizeName(row[1]));
    if (!user) return;

    dateColumns.forEach(({ index, date }) => {
      const shift = String(row[index] || '').trim().toUpperCase();
      if (!shift) return;
      schedules.push({ userId: user.id, date, shift });
    });
  });

  return schedules;
}

function applyTemporaryRosterSchedules(db) {
  const rosterSchedules = readTemporaryRosterSchedules(db);
  if (!rosterSchedules.length) return false;

  const rosterUserIds = new Set(rosterSchedules.map(item => item.userId));
  const rosterDates = new Set(rosterSchedules.map(item => item.date));
  const rosterMap = new Map(rosterSchedules.map(item => [`${item.userId}|${item.date}`, item.shift]));

  const existingRosterSchedules = db.schedules.filter(item =>
    rosterUserIds.has(item.userId) && rosterDates.has(item.date)
  );

  const alreadyApplied =
    existingRosterSchedules.length === rosterMap.size &&
    existingRosterSchedules.every(item => rosterMap.get(`${item.userId}|${item.date}`) === item.shift);

  if (alreadyApplied) return false;

  db.schedules = db.schedules.filter(item =>
    !(rosterUserIds.has(item.userId) && rosterDates.has(item.date))
  );
  db.confirmations = db.confirmations.filter(item =>
    !(rosterUserIds.has(item.userId) && rosterDates.has(item.date))
  );

  db.schedules.push(...rosterSchedules);
  db.schedules.sort((a, b) => a.date.localeCompare(b.date) || a.userId - b.userId);
  return true;
}

function emptyDatabase() {
  return {
    nextUserId: 2,
    nextLeaveId: 1,
    temporaryRosterImportedAt: null,
    users: [
      {
        id: 1,
        role: 'admin',
        name: 'Admin',
        phone: '',
        ssid: 'admin',
        email: 'admin@iiserb.ac.in',
        designation: 'Administrator',
        priority: 10,
        mustChangePassword: false,
        passwordHash: bcrypt.hashSync('admin123', 10),
        createdAt: new Date().toISOString()
      }
    ],
    schedules: [],
    confirmations: [],
    leaves: [],
    attendance: [],
    removedWorkers: [],
    passwordResetCodes: [],
    preconfirmations: [],
    gateConfirmations: [],
    pushSubscriptions: [],
    sentShiftNotifications: [],
    pushVapidKeys: null,
    shiftReassignments: [],
    nextAdminActivityLogId: 1,
    adminActivityLogs: [],
    nextCommunityPostId: 1,
    communityPosts: [],
    nextPollId: 1,
    polls: [],
    nextProfileChangeRequestId: 1,
    profileChangeRequests: []
  };
}

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const bundledDbPath = path.join(BUNDLED_DATA_DIR, 'database.json');
    if (DATA_DIR !== BUNDLED_DATA_DIR && fs.existsSync(bundledDbPath)) {
      fs.copyFileSync(bundledDbPath, DB_PATH);
    } else {
      fs.writeFileSync(DB_PATH, JSON.stringify(emptyDatabase(), null, 2));
    }
  }
}

async function readDb() {
  ensureDatabase();
  const raw = await fs.promises.readFile(DB_PATH, 'utf8');
  const db = JSON.parse(raw);
  let changed = false;
  db.users.forEach(user => {
    if (user.mustChangePassword === undefined) {
      user.mustChangePassword = user.role === 'staff';
      changed = true;
    }
  });
  if (!Array.isArray(db.removedWorkers)) {
    db.removedWorkers = [];
    changed = true;
  }
  if (!Array.isArray(db.profileChangeRequests)) {
    db.profileChangeRequests = [];
    changed = true;
  }
  if (!Array.isArray(db.passwordResetCodes)) {
    db.passwordResetCodes = [];
    changed = true;
  }
  if (!Array.isArray(db.preconfirmations)) {
    db.preconfirmations = [];
    changed = true;
  }
  if (!Array.isArray(db.gateConfirmations)) {
    db.gateConfirmations = [];
    changed = true;
  }
  if (!Array.isArray(db.pushSubscriptions)) {
    db.pushSubscriptions = [];
    changed = true;
  }
  if (!Array.isArray(db.sentShiftNotifications)) {
    db.sentShiftNotifications = [];
    changed = true;
  }
  if (db.pushVapidKeys === undefined) {
    db.pushVapidKeys = null;
    changed = true;
  }
  if (!Array.isArray(db.shiftReassignments)) {
    db.shiftReassignments = [];
    changed = true;
  }
  if (!Array.isArray(db.adminActivityLogs)) {
    db.adminActivityLogs = [];
    changed = true;
  }
  if (!db.nextAdminActivityLogId) {
    const maxId = db.adminActivityLogs.reduce((max, item) => Math.max(max, item.id || 0), 0);
    db.nextAdminActivityLogId = maxId + 1;
    changed = true;
  }
  if (!Array.isArray(db.communityPosts)) {
    db.communityPosts = [];
    changed = true;
  }
  if (!db.nextCommunityPostId) {
    const maxId = db.communityPosts.reduce((max, item) => Math.max(max, item.id || 0), 0);
    db.nextCommunityPostId = maxId + 1;
    changed = true;
  }
  if (!Array.isArray(db.polls)) {
    db.polls = [];
    changed = true;
  }
  if (!db.nextPollId) {
    const maxId = db.polls.reduce((max, item) => Math.max(max, item.id || 0), 0);
    db.nextPollId = maxId + 1;
    changed = true;
  }
  if (!db.nextProfileChangeRequestId) {
    const maxId = db.profileChangeRequests.reduce((max, item) => Math.max(max, item.id || 0), 0);
    db.nextProfileChangeRequestId = maxId + 1;
    changed = true;
  }
  if (!db.temporaryRosterImportedAt) {
    const hasExistingSchedules = db.schedules.length > 0;
    const importedSchedules = hasExistingSchedules ? false : applyTemporaryRosterSchedules(db);
    if (hasExistingSchedules || importedSchedules) {
      db.temporaryRosterImportedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await writeDb(db);
  return db;
}

async function writeDb(data) {
  ensureDatabase();
  await fs.promises.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, priority, ...safe } = user;
  return safe;
}

async function findUserBySsid(ssid) {
  const db = await readDb();
  const normalized = String(ssid || '').trim().toLowerCase();
  return db.users.find(user => String(user.ssid || '').toLowerCase() === normalized) || null;
}

async function findAdminByEmail(email) {
  const db = await readDb();
  const normalized = String(email || '').trim().toLowerCase();
  return db.users.find(user => user.role === 'admin' && String(user.email || '').toLowerCase() === normalized) || null;
}

async function findStaffByPhone(phone) {
  const db = await readDb();
  const normalized = String(phone || '').trim();
  return db.users.find(user => user.role === 'staff' && String(user.phone || '').trim() === normalized) || null;
}

async function listWorkers(search = '') {
  const db = await readDb();
  const q = search.trim().toLowerCase();
  return db.users
    .filter(user => user.role === 'staff')
    .filter(user => !q || user.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(publicUser);
}

async function getWorker(id) {
  const db = await readDb();
  const numericId = Number(id);
  const user = db.users.find(item => item.id === numericId && item.role === 'staff');
  if (!user) return null;

  const schedules = db.schedules
    .filter(item => item.userId === numericId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ userId, ...item }) => item);
  const confirmations = db.confirmations
    .filter(item => item.userId === numericId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ userId, ...item }) => item);
  const leaves = db.leaves
    .filter(item => item.userId === numericId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ userId, ...item }) => item);
  const attendance = db.attendance
    .filter(item => item.userId === numericId)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ userId, ...item }) => item);

  const preconfirmations = db.preconfirmations
    .filter(item => item.userId === numericId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ userId, ...item }) => item);

  const gateConfirmations = db.gateConfirmations
    .filter(item => item.userId === numericId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ userId, ...item }) => item);

  const shiftCounts = { A: 0, B: 0, C: 0, W: 0, N: 0, F: 0 };
  schedules.forEach(item => {
    const shift = normalizeShiftForCounts(item.shift);
    if (shiftCounts[shift] !== undefined) shiftCounts[shift] += 1;
  });

  return { user: publicUser(user), schedules, confirmations, preconfirmations, gateConfirmations, leaves, attendance, shiftCounts };
}

async function createWorker(input) {
  const db = await readDb();
  const ssid = String(input.ssid || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();

  if (db.users.some(user => String(user.ssid || '').toLowerCase() === ssid.toLowerCase())) {
    const err = new Error('SSID already exists');
    err.code = 'DUPLICATE';
    throw err;
  }
  if (email && db.users.some(user => String(user.email || '').toLowerCase() === email)) {
    const err = new Error('Email already exists');
    err.code = 'DUPLICATE';
    throw err;
  }

  const user = {
    id: db.nextUserId++,
    role: 'staff',
    name: String(input.name || '').trim(),
    phone,
    ssid,
    email,
    designation: String(input.designation || '').trim(),
    priority: 7,
    mustChangePassword: true,
    passwordHash: await bcrypt.hash(input.password, 10),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  await writeDb(db);
  return publicUser(user);
}

async function removeWorker({ workerId, reason, removedBy }) {
  const db = await readDb();
  const numericId = Number(workerId);
  const userIndex = db.users.findIndex(item => item.id === numericId && item.role === 'staff');
  if (userIndex === -1) return false;

  const [removedUser] = db.users.splice(userIndex, 1);
  db.schedules = db.schedules.filter(item => item.userId !== numericId);
  db.confirmations = db.confirmations.filter(item => item.userId !== numericId);
  db.leaves = db.leaves.filter(item => item.userId !== numericId);
  db.attendance = db.attendance.filter(item => item.userId !== numericId);
  db.profileChangeRequests = db.profileChangeRequests.filter(item => item.userId !== numericId);
  db.removedWorkers.push({
    worker: publicUser(removedUser),
    reason: String(reason || '').trim(),
    removedBy: removedBy || null,
    removedAt: new Date().toISOString()
  });

  await writeDb(db);
  return true;
}

function pickProfileFields(input, allowSsid = false) {
  const fields = {
    name: String(input.name || '').trim(),
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    designation: String(input.designation || '').trim()
  };
  if (allowSsid) fields.ssid = String(input.ssid || '').trim();
  return fields;
}

async function updateWorkerProfile(workerId, input) {
  const db = await readDb();
  const numericId = Number(workerId);
  const user = db.users.find(item => item.id === numericId && item.role === 'staff');
  if (!user) return 'missing';

  const updates = pickProfileFields(input, true);
  if (!updates.name || !updates.phone || !updates.email || !updates.designation || !updates.ssid) {
    return 'invalid';
  }
  if (db.users.some(item => item.id !== numericId && String(item.ssid || '').toLowerCase() === updates.ssid.toLowerCase())) {
    return 'duplicate-ssid';
  }
  if (db.users.some(item => item.id !== numericId && String(item.email || '').toLowerCase() === updates.email.toLowerCase())) {
    return 'duplicate-email';
  }

  Object.assign(user, updates, { updatedAt: new Date().toISOString() });
  await writeDb(db);
  return publicUser(user);
}

async function createProfileChangeRequest(userId, input) {
  const db = await readDb();
  const numericId = Number(userId);
  const user = db.users.find(item => item.id === numericId && item.role === 'staff');
  if (!user) return 'missing';

  const requested = pickProfileFields(input, false);
  if (!requested.name || !requested.phone || !requested.email || !requested.designation) return 'invalid';
  if (db.users.some(item => item.id !== numericId && String(item.email || '').toLowerCase() === requested.email.toLowerCase())) {
    return 'duplicate-email';
  }

  const current = pickProfileFields(user, false);
  const changes = {};
  Object.keys(requested).forEach(key => {
    if (requested[key] !== current[key]) changes[key] = requested[key];
  });
  if (!Object.keys(changes).length) return 'no-change';

  db.profileChangeRequests
    .filter(item => item.userId === numericId && item.status === 'pending')
    .forEach(item => {
      item.status = 'superseded';
      item.decidedAt = new Date().toISOString();
    });

  const request = {
    id: db.nextProfileChangeRequestId++,
    userId: numericId,
    workerName: user.name,
    workerSsid: user.ssid,
    current,
    requested,
    changes,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  db.profileChangeRequests.push(request);
  await writeDb(db);
  return request;
}

async function getProfileChangeRequests(status = 'pending') {
  const db = await readDb();
  return db.profileChangeRequests
    .filter(item => !status || item.status === status)
    .map(item => {
      const user = db.users.find(u => u.id === item.userId);
      return { ...item, workerName: user ? user.name : item.workerName, workerSsid: user ? user.ssid : item.workerSsid };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function staffProfileChangeRequests(userId) {
  const db = await readDb();
  return db.profileChangeRequests
    .filter(item => item.userId === Number(userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function decideProfileChangeRequest({ requestId, action, decidedBy }) {
  const db = await readDb();
  const request = db.profileChangeRequests.find(item => item.id === Number(requestId));
  if (!request) return 'missing';
  if (request.status !== 'pending') return 'closed';
  if (!['approved', 'rejected'].includes(action)) return 'invalid';

  request.status = action;
  request.decidedAt = new Date().toISOString();
  request.decidedBy = decidedBy || null;

  if (action === 'approved') {
    const user = db.users.find(item => item.id === request.userId && item.role === 'staff');
    if (!user) return 'worker-missing';
    if (db.users.some(item => item.id !== request.userId && String(item.email || '').toLowerCase() === request.requested.email.toLowerCase())) {
      request.status = 'rejected';
      request.rejectionReason = 'Email already exists';
      await writeDb(db);
      return 'duplicate-email';
    }
    Object.assign(user, request.requested, { updatedAt: new Date().toISOString() });
  }

  await writeDb(db);
  return 'ok';
}

async function resetPassword({ ssid, phone, password }) {
  const db = await readDb();
  const normalizedSsid = String(ssid || '').trim().toLowerCase();
  const normalizedPhone = String(phone || '').trim();
  const user = db.users.find(item =>
    String(item.ssid || '').toLowerCase() === normalizedSsid &&
    String(item.phone || '').trim() === normalizedPhone
  );
  if (!user) return false;
  user.passwordHash = await bcrypt.hash(password, 10);
  user.mustChangePassword = false;
  await writeDb(db);
  return true;
}

async function createPasswordResetCode({ userId, code, channel }) {
  const db = await readDb();
  const numericId = Number(userId);
  const user = db.users.find(item => item.id === numericId);
  if (!user) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  db.passwordResetCodes
    .filter(item => item.userId === numericId && !item.usedAt)
    .forEach(item => {
      item.usedAt = now.toISOString();
      item.status = 'superseded';
    });

  db.passwordResetCodes.push({
    userId: numericId,
    role: user.role,
    channel,
    codeHash: await bcrypt.hash(String(code), 10),
    createdAt: now.toISOString(),
    expiresAt,
    usedAt: null,
    status: 'pending'
  });

  await writeDb(db);
  return { expiresAt, user: publicUser(user) };
}

async function resetPasswordWithCode({ role, identifier, code, password }) {
  const db = await readDb();
  const normalizedIdentifier = String(identifier || '').trim().toLowerCase();
  const user = db.users.find(item => {
    if (item.role !== role) return false;
    if (role === 'admin') return String(item.email || '').trim().toLowerCase() === normalizedIdentifier;
    return String(item.phone || '').trim() === String(identifier || '').trim();
  });
  if (!user) return 'missing';

  const now = new Date();
  const resetCode = db.passwordResetCodes
    .filter(item => item.userId === user.id && item.role === role && item.status === 'pending' && !item.usedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  if (!resetCode) return 'missing-code';
  if (new Date(resetCode.expiresAt) < now) {
    resetCode.status = 'expired';
    resetCode.usedAt = now.toISOString();
    await writeDb(db);
    return 'expired';
  }

  const match = await bcrypt.compare(String(code || '').trim(), resetCode.codeHash);
  if (!match) return 'invalid-code';

  user.passwordHash = await bcrypt.hash(password, 10);
  user.mustChangePassword = false;
  resetCode.status = 'used';
  resetCode.usedAt = now.toISOString();
  await writeDb(db);
  return 'ok';
}

async function changePassword({ userId, currentPassword, newPassword }) {
  const db = await readDb();
  const user = db.users.find(item => item.id === Number(userId));
  if (!user) return 'missing';

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) return 'invalid';

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  await writeDb(db);
  return 'ok';
}

async function getDashboardStats() {
  const db = await readDb();
  const today = istDateString();
  const todayConfirmations = new Map(
    db.confirmations
      .filter(item => item.date === today)
      .map(item => [item.userId, item.status])
  );
  const todayPreconfirmed = new Set(
    db.preconfirmations
      .filter(item => item.date === today)
      .map(item => item.userId)
  );
  const todayArrived = new Set(
    db.gateConfirmations
      .filter(item => item.date === today)
      .map(item => item.userId)
  );
  return {
    totalWorkers: db.users.filter(user => user.role === 'staff').length,
    pendingLeaves: db.leaves.filter(item => item.status === 'pending').length,
    pendingConfirm: db.schedules.filter(item =>
      item.date === today &&
      isConfirmableShift(item.shift) &&
      todayConfirmations.get(item.userId) !== 'confirmed'
    ).length,
    todayShifts: db.schedules.filter(item => item.date === today && isConfirmableShift(item.shift)).length,
    preConfirmed: todayPreconfirmed.size,
    arrived: todayArrived.size
  };
}

async function getSchedulesForRange(from, to) {
  const db = await readDb();
  return db.schedules
    .filter(item => item.date >= from && item.date <= to)
    .map(item => {
      const user = db.users.find(u => u.id === item.userId);
      const confirmation = db.confirmations.find(c => c.userId === item.userId && c.date === item.date);
      return {
        user_id: item.userId,
        name: user ? user.name : 'Unknown',
        designation: user ? user.designation : '',
        date: item.date,
        shift: item.shift,
        confirmed: confirmation ? confirmation.status : null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date));
}

async function setSchedule({ userId, date, shift }) {
  const db = await readDb();
  const numericId = Number(userId);
  const existing = db.schedules.find(item => item.userId === numericId && item.date === date);
  if (existing) existing.shift = shift;
  else db.schedules.push({ userId: numericId, date, shift });
  await writeDb(db);
}

async function staffSchedule(userId, from, to) {
  const db = await readDb();
  const numericId = Number(userId);
  return db.schedules
    .filter(item => item.userId === numericId)
    .filter(item => !from || !to || (item.date >= from && item.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(item => {
      const confirmation = db.confirmations.find(c => c.userId === numericId && c.date === item.date);
      const preconfirm = db.preconfirmations.find(p => p.userId === numericId && p.date === item.date);
      const gateConfirm = db.gateConfirmations.find(g => g.userId === numericId && g.date === item.date);
      const att = db.attendance.find(a => a.userId === numericId && a.date === item.date);
      return {
        date: item.date,
        shift: item.shift,
        confirmation: confirmation ? confirmation.status : (isConfirmableShift(item.shift) ? 'pending' : null),
        preConfirmed: Boolean(preconfirm),
        preConfirmedAt: preconfirm ? preconfirm.preConfirmedAt : null,
        gateConfirmed: Boolean(gateConfirm),
        gateConfirmedAt: gateConfirm ? gateConfirm.gateConfirmedAt : null,
        gateDistance: gateConfirm ? gateConfirm.distanceFromGate : null,
        attendance: att ? att.status : null
      };
    });
}

async function pendingNotifications(userId) {
  const db = await readDb();
  return db.schedules
    .filter(item => item.userId === Number(userId) && isConfirmableShift(item.shift))
    .filter(item => {
      const confirmation = db.confirmations.find(c => c.userId === Number(userId) && c.date === item.date);
      return !confirmation || confirmation.status === 'pending';
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, shift }) => {
      const startAt = shiftStartUtcMs(date, shift);
      return {
        date,
        shift,
        label: shiftDisplayName(shift),
        startAt: startAt ? new Date(startAt).toISOString() : null,
        reminderAt: startAt ? new Date(startAt - SHIFT_REMINDER_LEAD_MINUTES * 60 * 1000).toISOString() : null
      };
    });
}

async function confirmShift({ userId, date, status }) {
  const db = await readDb();
  const numericId = Number(userId);
  if (date !== istDateString()) return 'not-today';
  const schedule = db.schedules.find(item => item.userId === numericId && item.date === date);
  if (!schedule) return 'missing';
  if (!isConfirmableShift(schedule.shift)) return 'blocked';
  const originalShift = schedule.shift;
  const existing = db.confirmations.find(item => item.userId === numericId && item.date === date);
  if (existing) {
    existing.status = status;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.confirmations.push({ userId: numericId, date, status, updatedAt: new Date().toISOString() });
  }

  const reassignment = status === 'declined'
    ? autoReassignDeclinedShift(db, { declinedBy: numericId, date, shift: originalShift })
    : null;

  await writeDb(db);
  return { status: 'ok', reassignment };
}

async function preConfirmShift({ userId, date }) {
  const db = await readDb();
  const numericId = Number(userId);
  if (date !== istDateString()) return 'not-today';
  const schedule = db.schedules.find(item => item.userId === numericId && item.date === date);
  if (!schedule) return 'missing';
  if (!isConfirmableShift(schedule.shift)) return 'blocked';
  if (!isWithinPreConfirmWindow(date, schedule.shift)) return 'too-early';

  const declined = db.confirmations.find(c => c.userId === numericId && c.date === date && c.status === 'declined');
  if (declined) return 'declined';

  const existing = db.preconfirmations.find(p => p.userId === numericId && p.date === date);
  if (existing) {
    return { status: 'ok', already: true, preConfirmedAt: existing.preConfirmedAt };
  }

  const now = new Date().toISOString();
  db.preconfirmations.push({
    userId: numericId,
    date,
    preConfirmedAt: now
  });

  const confirmRecord = db.confirmations.find(c => c.userId === numericId && c.date === date);
  if (confirmRecord) {
    confirmRecord.status = 'confirmed';
    confirmRecord.updatedAt = now;
  } else {
    db.confirmations.push({ userId: numericId, date, status: 'confirmed', updatedAt: now });
  }

  await writeDb(db);
  return { status: 'ok', preConfirmedAt: now };
}

async function gateConfirmShift({ userId, date, latitude, longitude }) {
  const db = await readDb();
  const numericId = Number(userId);
  if (date !== istDateString()) return 'not-today';
  const schedule = db.schedules.find(item => item.userId === numericId && item.date === date);
  if (!schedule) return 'missing';
  if (!isConfirmableShift(schedule.shift)) return 'blocked';

  const preconfirm = db.preconfirmations.find(p => p.userId === numericId && p.date === date);
  if (!preconfirm) return 'not-pre-confirmed';

  const existing = db.gateConfirmations.find(g => g.userId === numericId && g.date === date);
  if (existing) return 'already-arrived';

  const userLat = Number(latitude);
  const userLng = Number(longitude);
  if (isNaN(userLat) || isNaN(userLng)) return 'invalid-coords';

  const distance = haversineDistance(userLat, userLng, GATE_COORDS.latitude, GATE_COORDS.longitude);
  if (distance > GATE_COORDS.radiusMeters) {
    return { status: 'outside', distance: Math.round(distance), radius: GATE_COORDS.radiusMeters };
  }

  const now = new Date().toISOString();
  db.gateConfirmations.push({
    userId: numericId,
    date,
    gpsLat: userLat,
    gpsLng: userLng,
    distanceFromGate: Math.round(distance),
    gateConfirmedAt: now
  });

  const attExisting = db.attendance.find(a => a.userId === numericId && a.date === date);
  if (attExisting) {
    attExisting.status = 'present';
  } else {
    db.attendance.push({ userId: numericId, date, status: 'present' });
  }

  await writeDb(db);
  return {
    status: 'ok',
    distance: Math.round(distance),
    gateConfirmedAt: now
  };
}

function autoReassignDeclinedShift(db, { declinedBy, date, shift }) {
  return autoReassignShiftToMatchingN(db, {
    sourceUserId: declinedBy,
    date,
    shift,
    reason: 'declined'
  });
}

function autoReassignShiftToMatchingN(db, { sourceUserId, date, shift, reason, leaveId }) {
  const replacementShift = DECLINE_REPLACEMENT_SHIFTS[shift];
  if (!replacementShift) return null;
  const sourceSchedule = db.schedules.find(item => item.userId === sourceUserId && item.date === date);
  if (sourceSchedule) sourceSchedule.shift = 'N';

  db.confirmations = db.confirmations.filter(item =>
    !(item.userId === sourceUserId && item.date === date)
  );

  const candidates = db.schedules
    .filter(item => item.date === date && item.shift === replacementShift && item.userId !== sourceUserId)
    .filter(item => {
      const user = db.users.find(candidate => candidate.id === item.userId);
      if (!user || user.role !== 'staff') return false;
      return !db.leaves.some(leave =>
        leave.userId === item.userId &&
        leave.date === date &&
        (leave.status === 'approved' || leave.status === 'pending')
      );
    });

  if (!candidates.length) {
    db.shiftReassignments.push({
      date,
      shift,
      declinedBy: reason === 'declined' ? sourceUserId : null,
      leaveId: leaveId || null,
      sourceUserId,
      replacementUserId: null,
      replacementShift,
      reason,
      status: 'no-replacement',
      createdAt: new Date().toISOString()
    });
    return null;
  }

  const replacementSchedule = candidates[Math.floor(Math.random() * candidates.length)];
  const previousReplacementShift = replacementSchedule.shift;

  replacementSchedule.shift = shift;

  db.confirmations = db.confirmations.filter(item =>
    !(item.userId === replacementSchedule.userId && item.date === date)
  );

  db.shiftReassignments.push({
    date,
    shift,
    declinedBy: reason === 'declined' ? sourceUserId : null,
    leaveId: leaveId || null,
    sourceUserId,
    replacementUserId: replacementSchedule.userId,
    replacementShift: previousReplacementShift,
    reason,
    status: 'assigned',
    createdAt: new Date().toISOString()
  });

  const replacementUser = db.users.find(user => user.id === replacementSchedule.userId);
  return {
    userId: replacementSchedule.userId,
    name: replacementUser ? replacementUser.name : 'Replacement worker',
    previousShift: previousReplacementShift,
    assignedShift: shift
  };
}

async function savePushSubscription(userId, subscription) {
  const db = await readDb();
  const numericId = Number(userId);
  if (!subscription || !subscription.endpoint) return false;

  const existing = db.pushSubscriptions.find(item => item.endpoint === subscription.endpoint);
  const payload = {
    userId: numericId,
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    updatedAt: new Date().toISOString()
  };

  if (existing) Object.assign(existing, payload);
  else db.pushSubscriptions.push({ ...payload, createdAt: new Date().toISOString() });

  await writeDb(db);
  return true;
}

async function removePushSubscription(userId, endpoint) {
  const db = await readDb();
  const numericId = Number(userId);
  const before = db.pushSubscriptions.length;
  db.pushSubscriptions = db.pushSubscriptions.filter(item =>
    !(item.userId === numericId && (!endpoint || item.endpoint === endpoint))
  );
  if (db.pushSubscriptions.length !== before) await writeDb(db);
  return true;
}

async function removePushSubscriptionByEndpoint(endpoint) {
  const db = await readDb();
  const before = db.pushSubscriptions.length;
  db.pushSubscriptions = db.pushSubscriptions.filter(item => item.endpoint !== endpoint);
  if (db.pushSubscriptions.length !== before) await writeDb(db);
}

async function getPushSubscriptionsForUsers(userIds) {
  const db = await readDb();
  const allowed = new Set(userIds.map(id => Number(id)));
  return db.pushSubscriptions.filter(item => allowed.has(item.userId));
}

async function getDueShiftNotifications(now = new Date()) {
  const db = await readDb();
  const nowMs = now.getTime();
  const sent = new Set(db.sentShiftNotifications.map(item => item.key));
  const subscriptionsByUser = new Map();

  db.pushSubscriptions.forEach(subscription => {
    if (!subscriptionsByUser.has(subscription.userId)) subscriptionsByUser.set(subscription.userId, []);
    subscriptionsByUser.get(subscription.userId).push(subscription);
  });

  return db.schedules
    .filter(item => isConfirmableShift(item.shift))
    .map(item => {
      const startMs = shiftStartUtcMs(item.date, item.shift);
      if (!startMs) return null;
      const key = `${item.userId}|${item.date}|${item.shift}|${startMs}`;
      return { ...item, startMs, reminderMs: startMs - SHIFT_REMINDER_LEAD_MINUTES * 60 * 1000, key };
    })
    .filter(Boolean)
    .filter(item => nowMs >= item.reminderMs && nowMs < item.startMs && !sent.has(item.key))
    .filter(item => {
      const confirmation = db.confirmations.find(c => c.userId === item.userId && c.date === item.date);
      return !confirmation || confirmation.status === 'pending';
    })
    .filter(item => subscriptionsByUser.has(item.userId))
    .map(item => {
      const user = db.users.find(candidate => candidate.id === item.userId);
      return {
        key: item.key,
        userId: item.userId,
        workerName: user ? user.name : 'Staff',
        date: item.date,
        shift: item.shift,
        label: shiftDisplayName(item.shift),
        startAt: new Date(item.startMs).toISOString(),
        subscriptions: subscriptionsByUser.get(item.userId)
      };
    });
}

async function markShiftNotificationSent(notificationKey) {
  const db = await readDb();
  if (!db.sentShiftNotifications.some(item => item.key === notificationKey)) {
    db.sentShiftNotifications.push({ key: notificationKey, sentAt: new Date().toISOString() });
    await writeDb(db);
  }
}

async function ensurePushVapidKeys(createKeys) {
  const db = await readDb();
  if (!db.pushVapidKeys || !db.pushVapidKeys.publicKey || !db.pushVapidKeys.privateKey) {
    db.pushVapidKeys = createKeys();
    await writeDb(db);
  }
  return db.pushVapidKeys;
}

function canSeeCommunityPost(user, post) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (post.target === 'all') return true;
  return post.target === user.designation;
}

function publicCommunityPost(post, viewerId) {
  const reactions = post.reactions || [];
  const up = reactions.filter(item => item.reaction === 'up').length;
  const down = reactions.filter(item => item.reaction === 'down').length;
  const mine = reactions.find(item => item.userId === Number(viewerId));
  return {
    id: post.id,
    text: post.text,
    isAlert: Boolean(post.isAlert),
    target: post.target,
    media: post.media || [],
    authorName: post.authorName || 'Admin',
    createdAt: post.createdAt,
    reactionCounts: { up, down },
    myReaction: mine ? mine.reaction : null
  };
}

async function createCommunityPost({ authorId, text, isAlert, target, media }) {
  const db = await readDb();
  const author = db.users.find(user => user.id === Number(authorId) && user.role === 'admin');
  if (!author) return 'forbidden';
  const cleanText = String(text || '').trim();
  const cleanMedia = Array.isArray(media) ? media : [];
  if (!cleanText && !cleanMedia.length) return 'empty';

  const validTargets = ['all', ...new Set(db.users.filter(user => user.role === 'staff').map(user => user.designation).filter(Boolean))];
  const cleanTarget = validTargets.includes(target) ? target : 'all';

  const post = {
    id: db.nextCommunityPostId++,
    authorId: author.id,
    authorName: author.name,
    text: cleanText,
    isAlert: Boolean(isAlert),
    target: cleanTarget,
    media: cleanMedia,
    reactions: [],
    createdAt: new Date().toISOString()
  };
  db.communityPosts.push(post);
  await writeDb(db);
  return post;
}

async function listCommunityPosts(userId) {
  const db = await readDb();
  const user = db.users.find(item => item.id === Number(userId));
  return db.communityPosts
    .filter(post => canSeeCommunityPost(user, post))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(post => publicCommunityPost(post, userId));
}

async function reactToCommunityPost({ userId, postId, reaction }) {
  const db = await readDb();
  const numericUserId = Number(userId);
  const user = db.users.find(item => item.id === numericUserId);
  if (!user) return 'missing-user';
  const post = db.communityPosts.find(item => item.id === Number(postId));
  if (!post || !canSeeCommunityPost(user, post)) return 'missing';
  if (!['up', 'down'].includes(reaction)) return 'invalid';

  if (!Array.isArray(post.reactions)) post.reactions = [];
  const existing = post.reactions.find(item => item.userId === numericUserId);
  if (existing && existing.reaction === reaction) {
    post.reactions = post.reactions.filter(item => item.userId !== numericUserId);
  } else if (existing) {
    existing.reaction = reaction;
    existing.updatedAt = new Date().toISOString();
  } else {
    post.reactions.push({ userId: numericUserId, reaction, updatedAt: new Date().toISOString() });
  }
  await writeDb(db);
  return publicCommunityPost(post, userId);
}

async function communityRecipients(target) {
  const db = await readDb();
  return db.users
    .filter(user => user.role === 'staff')
    .filter(user => target === 'all' || user.designation === target)
    .map(publicUser);
}

function canSeePoll(user, poll) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (poll.target === 'all') return true;
  return poll.target === user.designation;
}

function publicPoll(poll, viewerId) {
  const viewerVote = poll.votes.find(v => v.userId === Number(viewerId));
  const counts = {};
  poll.options.forEach(o => { counts[o.id] = poll.votes.filter(v => v.optionId === o.id).length; });
  const totalVotes = poll.votes.length;
  const votedOptionId = viewerVote ? viewerVote.optionId : null;
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    target: poll.target,
    isAlert: Boolean(poll.isAlert),
    authorName: poll.authorName,
    createdAt: poll.createdAt,
    expiresAt: poll.expiresAt,
    status: poll.status,
    totalVotes,
    counts,
    votedOptionId
  };
}

async function createPoll({ authorId, question, options, target, durationMinutes, isAlert }) {
  const db = await readDb();
  const author = db.users.find(user => user.id === Number(authorId) && user.role === 'admin');
  if (!author) return 'forbidden';
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return 'empty';
  if (!Array.isArray(options) || options.length < 2) return 'too-few-options';
  if (options.length > 10) return 'too-many-options';
  const cleanOptions = options.map((text, i) => ({ id: i + 1, text: String(text || '').trim() })).filter(o => o.text);
  if (cleanOptions.length < 2) return 'too-few-options';

  const validTargets = ['all', ...new Set(db.users.filter(user => user.role === 'staff').map(user => user.designation).filter(Boolean))];
  const cleanTarget = validTargets.includes(target) ? target : 'all';
  const duration = Math.max(1, Math.min(Number(durationMinutes) || 1440, 43200));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

  const poll = {
    id: db.nextPollId++,
    authorId: author.id,
    authorName: author.name,
    question: cleanQuestion,
    options: cleanOptions,
    target: cleanTarget,
    isAlert: Boolean(isAlert),
    durationMinutes: duration,
    startsAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'active',
    createdAt: now.toISOString(),
    votes: []
  };
  db.polls.push(poll);
  await writeDb(db);
  return poll;
}

async function listPolls(userId) {
  const db = await readDb();
  const user = db.users.find(item => item.id === Number(userId));
  if (!user) return [];
  const now = new Date();
  db.polls.forEach(poll => {
    if (poll.status === 'active' && new Date(poll.expiresAt) < now) {
      poll.status = 'closed';
    }
  });
  return db.polls
    .filter(poll => canSeePoll(user, poll))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(poll => publicPoll(poll, userId));
}

async function votePoll({ userId, pollId, optionId }) {
  const db = await readDb();
  const numericUserId = Number(userId);
  const user = db.users.find(item => item.id === numericUserId);
  if (!user) return 'missing-user';

  const poll = db.polls.find(item => item.id === Number(pollId));
  if (!poll || !canSeePoll(user, poll)) return 'missing';
  if (poll.status === 'closed') return 'closed';
  if (new Date(poll.expiresAt) < new Date()) {
    poll.status = 'closed';
    await writeDb(db);
    return 'closed';
  }

  if (!poll.options.some(o => o.id === Number(optionId))) return 'invalid-option';

  if (!Array.isArray(poll.votes)) poll.votes = [];
  const existing = poll.votes.find(v => v.userId === numericUserId);
  if (existing) {
    existing.optionId = Number(optionId);
    existing.votedAt = new Date().toISOString();
  } else {
    poll.votes.push({ userId: numericUserId, optionId: Number(optionId), votedAt: new Date().toISOString() });
  }

  await writeDb(db);
  return publicPoll(poll, userId);
}

async function getAllLeaves() {
  const db = await readDb();
  return db.leaves
    .map(item => {
      const user = db.users.find(u => u.id === item.userId);
      return {
        ...item,
        workerName: user ? user.name : 'Unknown',
        workerDesignation: user ? user.designation : ''
      };
    })
    .sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (a.status !== 'pending' && b.status === 'pending') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

async function getMonthlyAttendanceReport(year, month) {
  const db = await readDb();
  const monthStr = String(Number(month)).padStart(2, '0');
  const yearStr = String(Number(year));
  const daysInMonth = new Date(yearStr, monthStr, 0).getDate();
  const staffUsers = db.users.filter(u => u.role === 'staff').sort((a, b) => a.name.localeCompare(b.name));

  const rows = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`;
    for (const user of staffUsers) {
      const schedule = db.schedules.find(s => s.userId === user.id && s.date === dateStr);
      if (!schedule) continue;
      const preconfirm = db.preconfirmations.find(p => p.userId === user.id && p.date === dateStr);
      const gateConfirm = db.gateConfirmations.find(g => g.userId === user.id && g.date === dateStr);
      const attendance = db.attendance.find(a => a.userId === user.id && a.date === dateStr);
      const leave = db.leaves.find(l => l.userId === user.id && l.date === dateStr && l.status === 'approved');
      const confirmation = db.confirmations.find(c => c.userId === user.id && c.date === dateStr);

      const shiftDef = SHIFT_STARTS[schedule.shift];
      const shiftStart = shiftDef ? `${dateStr}T${shiftDef.time}:00+05:30` : '';
      const shiftEndTime = { A: '14:00', B: '22:00', C: '06:00', G: '17:00' };
      const shiftEnd = shiftEndTime[schedule.shift] ? `${dateStr}T${shiftEndTime[schedule.shift]}:00+05:30` : '';

      rows.push({
        name: user.name,
        ssid: user.ssid,
        designation: user.designation,
        date: dateStr,
        shift: schedule.shift,
        shiftStart,
        shiftEnd,
        confirmation: confirmation ? confirmation.status : 'pending',
        preConfirmedAt: preconfirm ? preconfirm.preConfirmedAt : '',
        gateConfirmedAt: gateConfirm ? gateConfirm.gateConfirmedAt : '',
        gateLat: gateConfirm ? gateConfirm.gpsLat : '',
        gateLng: gateConfirm ? gateConfirm.gpsLng : '',
        gateDistance: gateConfirm ? gateConfirm.distanceFromGate : '',
        attendance: leave ? 'leave' : (attendance ? attendance.status : 'absent'),
        leaveReason: leave ? leave.reason : ''
      });
    }
  }
  return rows;
}

async function createLeave({ userId, date, reason }) {
  const db = await readDb();
  const numericId = Number(userId);
  if (db.leaves.some(item => item.userId === numericId && item.date === date)) return false;
  db.leaves.push({
    id: db.nextLeaveId++,
    userId: numericId,
    date,
    reason,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  await writeDb(db);
  return true;
}

function addAdminActivityLog(db, { adminId, type, message, details }) {
  const admin = db.users.find(user => user.id === Number(adminId));
  db.adminActivityLogs.push({
    id: db.nextAdminActivityLogId++,
    adminId: Number(adminId),
    adminName: admin ? admin.name : 'Admin',
    type,
    message,
    details: details || {},
    createdAt: new Date().toISOString()
  });
}

async function listAdminActivityLogs() {
  const db = await readDb();
  return db.adminActivityLogs
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
}

async function leaveAction({ leaveId, action, adminId }) {
  const db = await readDb();
  const leave = db.leaves.find(item => item.id === Number(leaveId));
  if (!leave) return false;
  const leaveWorker = db.users.find(user => user.id === leave.userId);
  const workerName = leaveWorker ? leaveWorker.name : 'Unknown worker';
  leave.status = action;
  let reassignment = null;
  let originalShift = null;
  if (action === 'approved') {
    const existing = db.attendance.find(item => item.userId === leave.userId && item.date === leave.date);
    if (existing) existing.status = 'leave';
    else db.attendance.push({ userId: leave.userId, date: leave.date, status: 'leave' });

    const schedule = db.schedules.find(item => item.userId === leave.userId && item.date === leave.date);
    if (schedule && isConfirmableShift(schedule.shift)) {
      originalShift = schedule.shift;
      reassignment = autoReassignShiftToMatchingN(db, {
        sourceUserId: leave.userId,
        date: leave.date,
        shift: schedule.shift,
        reason: 'leave-approved',
        leaveId: leave.id
      });
    }

    addAdminActivityLog(db, {
      adminId,
      type: 'leave-approved',
      message: originalShift
        ? reassignment
          ? `Approved leave for ${workerName} on ${leave.date}. Changed ${originalShift} to N and reassigned ${originalShift} to ${reassignment.name}.`
          : `Approved leave for ${workerName} on ${leave.date}. Changed ${originalShift} to N. No matching N-period replacement was available.`
        : `Approved leave for ${workerName} on ${leave.date}. No active A, B, or C shift required reassignment.`,
      details: {
        leaveId: leave.id,
        workerId: leave.userId,
        workerName,
        date: leave.date,
        originalShift,
        sourceNewShift: originalShift ? 'N' : null,
        replacement: reassignment
      }
    });
  } else {
    addAdminActivityLog(db, {
      adminId,
      type: 'leave-rejected',
      message: `Rejected leave for ${workerName} on ${leave.date}.`,
      details: {
        leaveId: leave.id,
        workerId: leave.userId,
        workerName,
        date: leave.date
      }
    });
  }
  await writeDb(db);
  return { success: true, reassignment };
}

async function staffLeaves(userId) {
  const db = await readDb();
  return db.leaves
    .filter(item => item.userId === Number(userId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ userId: _, ...item }) => item);
}

async function staffAttendance(userId) {
  const db = await readDb();
  return db.attendance
    .filter(item => item.userId === Number(userId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 60)
    .map(({ userId: _, ...item }) => item);
}

module.exports = {
  DB_PATH,
  CONFIRMABLE_SHIFTS,
  SHIFT_REMINDER_LEAD_MINUTES,
  communityRecipients,
  createLeave,
  createCommunityPost,
  createWorker,
  createProfileChangeRequest,
  changePassword,
  confirmShift,
  preConfirmShift,
  gateConfirmShift,
  getGateConfig,
  decideProfileChangeRequest,
  findAdminByEmail,
  findStaffByPhone,
  findUserBySsid,
  getDashboardStats,
  getSchedulesForRange,
  getDueShiftNotifications,
  getPushSubscriptionsForUsers,
  getWorker,
  ensurePushVapidKeys,
  getProfileChangeRequests,
  getAllLeaves,
  leaveAction,
  listAdminActivityLogs,
  listWorkers,
  listCommunityPosts,
  markShiftNotificationSent,
  pendingNotifications,
  publicUser,
  readDb,
  removePushSubscription,
  removePushSubscriptionByEndpoint,
  removeWorker,
  reactToCommunityPost,
  resetPassword,
  createPasswordResetCode,
  resetPasswordWithCode,
  savePushSubscription,
  setSchedule,
  staffAttendance,
  staffLeaves,
  staffProfileChangeRequests,
  updateWorkerProfile,
  staffSchedule,
  writeDb,
  createPoll,
  listPolls,
  votePoll,
  getMonthlyAttendanceReport
};
