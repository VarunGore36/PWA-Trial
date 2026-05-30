const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
const workbookPath = path.join(root, 'Staff list.xlsx');
const dbPath = path.join(root, 'data', 'database.json');
const python = 'C:\\Users\\varun\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';

function passwordForName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const last = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  const cleanLast = last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
  return parts[0].charAt(0).toUpperCase() + cleanLast;
}

const pythonCode = `
import json
import openpyxl

path = r'''${workbookPath}'''
wb = openpyxl.load_workbook(path, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = []

for idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
    if not any(value is not None and str(value).strip() for value in row):
        continue

    phone = row[3]
    if isinstance(phone, float) and phone.is_integer():
        phone = str(int(phone))
    elif isinstance(phone, int):
        phone = str(phone)
    elif phone is None:
        phone = ''
    else:
        phone = str(phone).strip()

    rows.append({
        'sourceRow': idx,
        'name': str(row[1]).strip() if row[1] is not None else '',
        'ssid': str(row[2]).strip() if row[2] is not None else '',
        'phone': phone,
        'email': str(row[4]).strip().lower() if row[4] is not None else '',
        'designation': str(row[5]).strip() if row[5] is not None else ''
    })

print(json.dumps(rows, ensure_ascii=False))
`;

const rows = JSON.parse(execFileSync(python, ['-c', pythonCode], { encoding: 'utf8' }));
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const existingSsids = new Set(db.users.map(user => String(user.ssid || '').toLowerCase()));
const existingEmails = new Set(db.users.map(user => String(user.email || '').toLowerCase()).filter(Boolean));
const seenSsids = new Set();
const seenEmails = new Set();
const skipped = [];
const imported = [];

let nextUserId = Number(db.nextUserId) || Math.max(0, ...db.users.map(user => Number(user.id) || 0)) + 1;

for (const row of rows) {
  const ssidKey = row.ssid.toLowerCase();
  const emailKey = row.email.toLowerCase();
  const missing = ['name', 'ssid', 'phone', 'email', 'designation'].filter(field => !row[field]);

  if (missing.length) {
    skipped.push({ sourceRow: row.sourceRow, name: row.name, reason: `missing ${missing.join(', ')}` });
    continue;
  }
  if (existingSsids.has(ssidKey) || seenSsids.has(ssidKey)) {
    skipped.push({ sourceRow: row.sourceRow, name: row.name, ssid: row.ssid, reason: 'duplicate SIS ID' });
    continue;
  }
  if (existingEmails.has(emailKey) || seenEmails.has(emailKey)) {
    skipped.push({ sourceRow: row.sourceRow, name: row.name, email: row.email, reason: 'duplicate email' });
    continue;
  }

  const plainPassword = passwordForName(row.name);
  db.users.push({
    id: nextUserId++,
    role: 'staff',
    name: row.name.replace(/\s+/g, ' '),
    phone: row.phone,
    ssid: row.ssid,
    email: row.email,
    designation: row.designation,
    priority: 7,
    mustChangePassword: true,
    passwordHash: bcrypt.hashSync(plainPassword, 10),
    createdAt: new Date().toISOString()
  });

  existingSsids.add(ssidKey);
  existingEmails.add(emailKey);
  seenSsids.add(ssidKey);
  seenEmails.add(emailKey);
  imported.push({ sourceRow: row.sourceRow, name: row.name, ssid: row.ssid, password: plainPassword });
}

db.nextUserId = nextUserId;
fs.writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');

console.log(JSON.stringify({
  spreadsheetRows: rows.length,
  imported: imported.length,
  skipped: skipped.length,
  skippedRows: skipped,
  samplePasswords: imported.slice(0, 10)
}, null, 2));
