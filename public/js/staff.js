function shiftBadge(shift) {
  const s = (shift || 'N').toUpperCase();
  return `<span class="shift-badge shift-${s}">${s}</span>`;
}
function statusBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}
function fmtDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function toDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return toDateInput(d);
}
function todayStr() {
  return toDateInput(new Date());
}
let staffScheduleRows = [];
let staffScheduleFocusDate = todayStr();

async function logout() {
  if (!(await confirmLogout())) return;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}
function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'leaves') loadLeaves();
  if (name === 'attendance') loadAttendance();
  if (name === 'confirm') loadPendingConfirm();
  if (name === 'profile') loadProfile();
}

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const me = await res.json();
  document.getElementById('staff-name').textContent = me.name;

  if (me.mustChangePassword) {
    document.getElementById('password-change-card').style.display = 'block';
    document.getElementById('staff-main').style.display = 'none';
    return;
  }

  loadSchedule();
  loadNotifications();
}

async function changePassword() {
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  const msgEl = document.getElementById('password-change-msg');
  msgEl.innerHTML = '';

  if (!currentPassword || !newPassword || !confirmPassword) {
    msgEl.innerHTML = '<div class="alert alert-error">All password fields are required.</div>';
    return;
  }
  if (newPassword !== confirmPassword) {
    msgEl.innerHTML = '<div class="alert alert-error">New passwords do not match.</div>';
    return;
  }

  const res = await fetch('/api/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = await res.json();

  if (!res.ok) {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error || 'Password change failed.'}</div>`;
    return;
  }

  document.getElementById('password-change-card').style.display = 'none';
  document.getElementById('staff-main').style.display = 'block';
  loadSchedule();
  loadNotifications();
}

async function loadSchedule() {
  const res = await fetch('/api/staff/schedule?from=2026-05-26&to=2026-06-25');
  if (!res.ok) return;
  staffScheduleRows = await res.json();

  const container = document.getElementById('schedule-weeks');
  if (!staffScheduleRows.length) {
    container.innerHTML = '<div class="empty-state">No schedule assigned.</div>';
    return;
  }

  renderScheduleWindow();
}

function focusedScheduleIndex() {
  const exact = staffScheduleRows.findIndex(item => item.date === staffScheduleFocusDate);
  if (exact !== -1) return exact;
  const next = staffScheduleRows.findIndex(item => item.date > staffScheduleFocusDate);
  return next === -1 ? staffScheduleRows.length - 1 : next;
}

function moveStaffSchedule(delta) {
  if (!staffScheduleRows.length) return;
  const nextIndex = Math.max(0, Math.min(staffScheduleRows.length - 1, focusedScheduleIndex() + delta));
  staffScheduleFocusDate = staffScheduleRows[nextIndex].date;
  renderScheduleWindow();
}

function renderScheduleWindow() {
  const container = document.getElementById('schedule-weeks');
  const focusIndex = focusedScheduleIndex();
  const start = Math.max(0, focusIndex - 5);
  const end = Math.min(staffScheduleRows.length, focusIndex + 6);
  const visible = staffScheduleRows.slice(start, end);
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const focus = staffScheduleRows[focusIndex];
  const focusDate = new Date(focus.date + 'T00:00:00');

  const cards = visible.map(item => {
    const dt = new Date(item.date + 'T00:00:00');
    const isFocus = item.date === focus.date;
    const isToday = item.date === todayStr();
    return `
      <div class="shift-strip-item ${isFocus ? 'active' : ''}">
        <div>
          <div class="shift-strip-day">${dayNames[dt.getDay()]}</div>
          <div class="shift-strip-date">${fmtDate(item.date)}${isToday ? ' · Today' : ''}</div>
        </div>
        ${shiftBadge(item.shift)}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="staff-schedule-nav">
      <button class="btn btn-outline schedule-arrow" onclick="moveStaffSchedule(-1)" ${focusIndex === 0 ? 'disabled' : ''} title="Previous shift">&larr;</button>
      <div class="today-shift-card">
        <div>
          <div class="today-shift-date">${dayNames[focusDate.getDay()]}, ${fmtDate(focus.date)}</div>
          <div class="today-shift-copy">${focus.date === todayStr() ? 'Your assigned shift for today' : 'Selected assigned shift'}</div>
        </div>
        <div class="today-shift-badge">${shiftBadge(focus.shift)}</div>
      </div>
      <button class="btn btn-outline schedule-arrow" onclick="moveStaffSchedule(1)" ${focusIndex === staffScheduleRows.length - 1 ? 'disabled' : ''} title="Next shift">&rarr;</button>
    </div>
    <div class="shift-strip">${cards}</div>
  `;
}

async function loadNotifications() {
  const banner = document.getElementById('notif-banner');
  banner.style.display = 'block';
  banner.textContent = 'Shift confirmation push notification will arrive 30 minutes before your assigned shift.';
}

function currentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  const from = toDateInput(start);
  return { from, to: addDays(from, 6) };
}

async function loadPendingConfirm() {
  const { from, to } = currentWeekRange();
  const res = await fetch(`/api/staff/schedule?from=${from}&to=${to}`);
  if (!res.ok) return;
  const week = await res.json();

  const container = document.getElementById('confirm-list');
  if (!week.length) {
    container.innerHTML = '<div class="empty-state">No shifts assigned this week.</div>';
    return;
  }

  const shiftLabels = { A: 'Morning (A)', B: 'Noon (B)', C: 'Evening (C)' };
  container.innerHTML = `
    <div class="alert alert-info">You will receive a push notification 30 minutes before each confirmable shift.</div>
    <table>
      <thead><tr><th>Date</th><th>Day</th><th>Shift</th><th>Confirmation</th></tr></thead>
      <tbody>
        ${week.map(p => {
          const dt = new Date(p.date + 'T00:00:00');
          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const confirmable = ['A', 'B', 'C'].includes(p.shift);
          return `<tr>
            <td>${fmtDate(p.date)}</td>
            <td>${dayNames[dt.getDay()]}</td>
            <td>${shiftBadge(p.shift)} ${shiftLabels[p.shift] || p.shift}</td>
            <td>${confirmable ? 'Push 30 min before shift' : '-'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function submitLeave() {
  const date = document.getElementById('leave-date').value;
  const reason = document.getElementById('leave-reason').value.trim();
  const msgEl = document.getElementById('leave-msg');
  msgEl.innerHTML = '';

  if (!date || !reason) {
    msgEl.innerHTML = '<div class="alert alert-error">Date and reason are required.</div>';
    return;
  }

  const res = await fetch('/api/staff/leave-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, reason }),
  });
  const data = await res.json();

  if (res.ok) {
    msgEl.innerHTML = '<div class="alert alert-success">Leave request submitted.</div>';
    document.getElementById('leave-date').value = '';
    document.getElementById('leave-reason').value = '';
    loadLeaves();
  } else {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
  }
}

async function loadLeaves() {
  const res = await fetch('/api/staff/my-leaves');
  if (!res.ok) return;
  const leaves = await res.json();
  const container = document.getElementById('leave-history');

  if (!leaves.length) {
    container.innerHTML = '<div class="empty-state">No leave requests submitted.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${fmtDate(l.date)}</td>
          <td>${l.reason}</td>
          <td>${statusBadge(l.status)}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

async function loadAttendance() {
  const res = await fetch('/api/staff/my-attendance');
  if (!res.ok) return;
  const records = await res.json();
  const container = document.getElementById('attendance-table');

  if (!records.length) {
    container.innerHTML = '<div class="empty-state">No attendance records found.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Status</th></tr></thead>
      <tbody>${records.map(r => `
        <tr>
          <td>${fmtDate(r.date)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

async function loadProfile() {
  const profileRes = await fetch('/api/staff/profile');
  if (!profileRes.ok) return;
  const profile = await profileRes.json();

  document.getElementById('staff-profile-name').value = profile.name || '';
  document.getElementById('staff-profile-phone').value = profile.phone || '';
  document.getElementById('staff-profile-ssid').value = profile.ssid || '';
  document.getElementById('staff-profile-email').value = profile.email || '';
  document.getElementById('staff-profile-designation').value = profile.designation || 'SG';

  loadProfileRequestHistory();
}

async function submitProfileChange() {
  const msgEl = document.getElementById('profile-msg');
  msgEl.innerHTML = '';

  const payload = {
    name: document.getElementById('staff-profile-name').value.trim(),
    phone: document.getElementById('staff-profile-phone').value.trim(),
    email: document.getElementById('staff-profile-email').value.trim(),
    designation: document.getElementById('staff-profile-designation').value
  };

  const res = await fetch('/api/staff/profile-change-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error || 'Profile change request failed.'}</div>`;
    return;
  }

  msgEl.innerHTML = '<div class="alert alert-success">Profile change request submitted for admin approval.</div>';
  loadProfileRequestHistory();
}

async function loadProfileRequestHistory() {
  const res = await fetch('/api/staff/profile-change-requests');
  if (!res.ok) return;
  const requests = await res.json();
  const container = document.getElementById('profile-request-history');

  if (!requests.length) {
    container.innerHTML = '<div class="empty-state">No profile change requests submitted.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Changes</th><th>Status</th></tr></thead>
      <tbody>${requests.map(r => `
        <tr>
          <td>${fmtDate(r.createdAt.slice(0, 10))}</td>
          <td>${Object.keys(r.changes).map(key => `
            <div style="margin-bottom:6px;"><strong>${key}</strong>: ${r.current[key] || '-'} &rarr; ${r.requested[key] || '-'}</div>
          `).join('')}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

init();
