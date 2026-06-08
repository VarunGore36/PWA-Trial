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
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
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
  if (name === 'schedule') loadSchedule();
  if (name === 'leaves') loadLeaves();
  if (name === 'attendance') loadAttendance();
  if (name === 'confirm') loadPendingConfirm();
  if (name === 'profile') loadProfile();
  if (name === 'community') { staffCommunityFilter = 'posts'; loadCommunityFeed(); loadStaffCommunityPolls(); }
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

  await loadGateConfig();
  loadSchedule();
  loadNotifications();
  window.setInterval(refreshStaffDashboard, 30 * 1000);
}

async function refreshStaffDashboard() {
  await loadSchedule();
  const activeTab = document.querySelector('.tab-content.active');
  if (!activeTab) return;

  if (activeTab.id === 'tab-confirm') await loadPendingConfirm();
  if (activeTab.id === 'tab-leaves') await loadLeaves();
  if (activeTab.id === 'tab-attendance') await loadAttendance();
  if (activeTab.id === 'tab-profile') await loadProfile();
  if (activeTab.id === 'tab-community') { await loadCommunityFeed(); await loadStaffCommunityPolls(); }
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
  const today = todayStr();

  const cards = visible.map(item => {
    const dt = new Date(item.date + 'T00:00:00');
    const isFocus = item.date === focus.date;
    const isToday = item.date === today;
    let extraStatus = '';
    if (isToday && ['A', 'B', 'C', 'G'].includes(item.shift)) {
      const flowStatus = getConfirmationFlowStatus(item);
      extraStatus = `<div style="font-size:11px;margin-top:4px;">${confirmationStatusBadge(flowStatus)}</div>`;
    }
    return `
      <div class="shift-strip-item ${isFocus ? 'active' : ''}">
        <div>
          <div class="shift-strip-day">${dayNames[dt.getDay()]}</div>
          <div class="shift-strip-date">${fmtDate(item.date)}${isToday ? ' · Today' : ''}</div>
          ${extraStatus}
        </div>
        ${shiftBadge(item.shift)}
      </div>
    `;
  }).join('');

  const focusFlowStatus = focus.date === today && ['A', 'B', 'C', 'G'].includes(focus.shift)
    ? getConfirmationFlowStatus(focus)
    : null;

  container.innerHTML = `
    <div class="staff-schedule-nav">
      <button class="btn btn-outline schedule-arrow" onclick="moveStaffSchedule(-1)" ${focusIndex === 0 ? 'disabled' : ''} title="Previous shift">&larr;</button>
      <div class="today-shift-card">
        <div>
          <div class="today-shift-date">${dayNames[focusDate.getDay()]}, ${fmtDate(focus.date)}</div>
          <div class="today-shift-copy">${focus.date === today ? 'Your assigned shift for today' : 'Selected assigned shift'}</div>
          ${focusFlowStatus ? `<div style="margin-top:8px;">${confirmationStatusBadge(focusFlowStatus)}</div>` : ''}
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
  const pendingRes = await fetch('/api/staff/notifications');
  const pending = pendingRes.ok ? await pendingRes.json() : [];

  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    banner.textContent = 'Push notifications are not supported in this browser.';
    return;
  }

  if (Notification.permission === 'granted') {
    try {
      await subscribeForShiftNotifications();
      banner.textContent = `Push reminders enabled for ${pending.length} pending shift${pending.length === 1 ? '' : 's'}. Reminders are sent 1 hour before the IST shift start time.`;
    } catch (error) {
      banner.textContent = 'Push notifications could not be enabled. Please try again after reconnecting.';
    }
    return;
  }

  if (Notification.permission === 'denied') {
    banner.textContent = 'Push notifications are blocked for this browser.';
    return;
  }

  banner.innerHTML = `
    <span>Enable push reminders for A 6:00 AM, B 2:00 PM, C 10:00 PM, and G 9:00 AM shifts.</span>
    <button class="btn btn-primary btn-sm" type="button" onclick="enableShiftNotifications()">Enable Notifications</button>
  `;
}

async function enableShiftNotifications() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    loadNotifications();
    return;
  }
  await subscribeForShiftNotifications();
  loadNotifications();
}

async function subscribeForShiftNotifications() {
  const keyRes = await fetch('/api/staff/push-public-key');
  if (!keyRes.ok) throw new Error('Push key unavailable');
  const { publicKey } = await keyRes.json();
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  const saveRes = await fetch('/api/staff/push-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  });
  if (!saveRes.ok) throw new Error('Subscription save failed');
}

let gateConfig = null;
let currentPosition = null;

async function loadGateConfig() {
  const res = await fetch('/api/staff/gate-config');
  if (res.ok) gateConfig = await res.json();
}

function statusText(status) {
  const labels = {
    'awaiting-preconfirm': 'Awaiting Pre-Confirmation',
    'pre-confirmed': 'Pre-Confirmed',
    'awaiting-gate': 'Awaiting Gate Check-In',
    'arrived': 'Checked In At Gate',
    'present': 'Present',
    'declined': 'Declined'
  };
  return labels[status] || status || 'Unknown';
}

function confirmationStatusBadge(status) {
  const cls = {
    'awaiting-preconfirm': 'awaiting',
    'pre-confirmed': 'pre-confirmed',
    'awaiting-gate': 'pre-confirmed',
    'arrived': 'arrived',
    'present': 'present',
    'declined': 'declined'
  };
  return `<span class="badge badge-${cls[status] || 'pending'}">${statusText(status)}</span>`;
}

function getConfirmationFlowStatus(item) {
  if (item.confirmation === 'declined') return 'declined';
  if (item.gateConfirmed) return 'present';
  if (item.preConfirmed) {
    const now = Date.now();
    const startMs = Date.parse(item.date + 'T00:00:00+05:30');
    const hours = ['A', 'B', 'C', 'G'];
    const shiftHours = { A: 6, B: 14, C: 22, G: 9 };
    if (hours.includes(item.shift)) {
      const shiftStart = Date.parse(`${item.date}T${String(shiftHours[item.shift]).padStart(2,'0')}:00:00+05:30`);
      if (now >= shiftStart) return 'arrived';
    }
    return 'awaiting-gate';
  }
  return 'awaiting-preconfirm';
}

async function preConfirmShift(date) {
  const res = await fetch('/api/staff/pre-confirm-shift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date }),
  });
  const data = await res.json();
  if (res.ok) {
    await loadPendingConfirm();
    await loadSchedule();
    const list = document.getElementById('confirm-list');
    list.insertAdjacentHTML('afterbegin', '<div class="alert alert-success">Pre-confirmed. Please check in at the gate when you arrive.</div>');
    return;
  }
  document.getElementById('confirm-list').insertAdjacentHTML(
    'afterbegin',
    `<div class="alert alert-error">${data.error || 'Pre-confirmation failed.'}</div>`
  );
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getCurrentPosition() {
  if (!navigator.geolocation) {
    throw new Error('Geolocation is not supported by this browser');
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

async function refreshGateCheckinStatus() {
  const statusEl = document.getElementById('gate-location-status');
  const coordsEl = document.getElementById('gate-coords-display');
  const btn = document.getElementById('btn-gate-checkin');
  statusEl.textContent = 'Fetching your location...';
  btn.disabled = true;

  try {
    const pos = await getCurrentPosition();
    currentPosition = pos;
    const dist = Math.round(haversineDistance(pos.lat, pos.lng, gateConfig.latitude, gateConfig.longitude));
    coordsEl.textContent = `Your location: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} · Distance from gate: ${dist}m · Allowed radius: ${gateConfig.radiusMeters}m`;

    if (dist <= gateConfig.radiusMeters) {
      statusEl.innerHTML = '<span style="color:var(--success);font-weight:600;">✓ You are at the gate area</span>';
      btn.disabled = false;
    } else {
      statusEl.innerHTML = `<span style="color:var(--danger);">✗ You are ${dist}m from the gate. Please reach the gate area (within ${gateConfig.radiusMeters}m).</span>`;
      btn.disabled = true;
    }
  } catch (err) {
    statusEl.textContent = 'Could not get location. Please enable location access and try again.';
    coordsEl.textContent = err.message || 'Location unavailable';
    btn.disabled = true;
  }
}

async function gateConfirmShift() {
  const today = todayStr();
  const btn = document.getElementById('btn-gate-checkin');
  btn.disabled = true;
  btn.textContent = 'Checking in...';

  let pos = currentPosition;
  if (!pos) {
    try {
      pos = await getCurrentPosition();
    } catch (err) {
      document.getElementById('gate-location-status').textContent = 'Could not get location. Please try again.';
      btn.disabled = false;
      btn.textContent = 'Check In At Gate';
      return;
    }
  }

  const res = await fetch('/api/staff/gate-confirm-shift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today, latitude: pos.lat, longitude: pos.lng }),
  });
  const data = await res.json();

  if (res.ok) {
    document.getElementById('gate-checkin-card').style.display = 'none';
    document.getElementById('confirm-list').insertAdjacentHTML(
      'afterbegin',
      `<div class="alert alert-success">✓ Checked in at gate (${data.distance}m from gate). Attendance marked as Present.</div>`
    );
    await loadPendingConfirm();
    await loadSchedule();
    return;
  }

  btn.disabled = false;
  btn.textContent = 'Check In At Gate';

  if (res.status === 403) {
    document.getElementById('gate-location-status').innerHTML =
      `<span style="color:var(--danger);">✗ ${data.error}</span>`;
  } else {
    document.getElementById('confirm-list').insertAdjacentHTML(
      'afterbegin',
      `<div class="alert alert-error">${data.error || 'Gate check-in failed.'}</div>`
    );
  }
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

  const shiftLabels = { A: 'Morning (A)', B: 'Noon (B)', C: 'Evening (C)', G: 'General (G)' };
  const today = todayStr();
  const todayRow = week.find(p => p.date === today);
  const confirmable = todayRow && ['A', 'B', 'C', 'G'].includes(todayRow.shift);

  let todayCardHtml = '';
  let showGateCard = false;

  if (todayRow && confirmable) {
    const flowStatus = getConfirmationFlowStatus(todayRow);
    const isDeclined = todayRow.confirmation === 'declined';
    const shiftHours = { A: 6, B: 14, C: 22, G: 9 };
    const shiftStartMs = Date.parse(`${today}T${String(shiftHours[todayRow.shift]).padStart(2,'0')}:00:00+05:30`);
    const windowStartMs = shiftStartMs - 60 * 60 * 1000;
    const now = Date.now();
    const withinWindow = now >= windowStartMs && now < shiftStartMs;

    let actionButtons = '';
    if (!isDeclined) {
      if (flowStatus === 'awaiting-preconfirm') {
        actionButtons = withinWindow
          ? `<button class="btn btn-primary btn-sm" onclick="preConfirmShift('${today}')">Pre-Confirm Shift</button>
             <button class="btn btn-danger btn-sm" onclick="confirmShift('${today}', 'declined')" style="margin-left:4px;">Decline</button>`
          : `<button class="btn btn-outline btn-sm" disabled title="Available 1 hour before shift start">Pre-Confirm (unavailable yet)</button>
             <button class="btn btn-danger btn-sm" onclick="confirmShift('${today}', 'declined')" style="margin-left:4px;">Decline</button>`;
      } else if (flowStatus === 'awaiting-gate') {
        showGateCard = true;
        actionButtons = `<span class="badge badge-pre-confirmed">Pre-Confirmed</span>
          <button class="btn btn-checkin btn-sm" onclick="document.querySelector('.tab-btn[onclick*=\\'confirm\\']').click();refreshGateCheckinStatus();document.getElementById('gate-checkin-card').style.display='block';">Check In At Gate</button>
          <button class="btn btn-danger btn-sm" onclick="confirmShift('${today}', 'declined')" style="margin-left:4px;">Decline</button>`;
      } else if (flowStatus === 'arrived' || flowStatus === 'present') {
        actionButtons = confirmationStatusBadge('present');
      }
    } else {
      actionButtons = statusBadge('declined');
    }

    todayCardHtml = `
      <div class="card" style="margin-bottom:16px;border-left:3px solid var(--primary);">
        <div class="card-header" style="border-bottom:none;margin-bottom:4px;padding-bottom:0;">Today · ${fmtDate(today)} · ${shiftBadge(todayRow.shift)} ${shiftLabels[todayRow.shift] || todayRow.shift}</div>
        <div class="confirm-status-row">
          <span class="confirm-status-label">Status:</span>
          ${confirmationStatusBadge(flowStatus)}
        </div>
        <div style="margin-top:12px;" class="confirm-status-row">
          ${actionButtons}
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    ${todayCardHtml}
    <div class="alert alert-info">You will receive a push notification 1 hour before each confirmable shift.</div>
    <table>
      <thead><tr><th>Date</th><th>Day</th><th>Shift</th><th>Status</th></tr></thead>
      <tbody>
        ${week.map(p => {
          const dt = new Date(p.date + 'T00:00:00');
          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const confirmableShift = ['A', 'B', 'C', 'G'].includes(p.shift);
          const isTodayRow = p.date === today;
          let statusCell;
          if (!confirmableShift) {
            statusCell = '-';
          } else if (!isTodayRow) {
            statusCell = '<span style="font-size:12px;color:var(--muted);">Unavailable</span>';
          } else {
            statusCell = confirmationStatusBadge(getConfirmationFlowStatus(p));
          }
          return `<tr>
            <td>${fmtDate(p.date)}</td>
            <td>${dayNames[dt.getDay()]}</td>
            <td>${shiftBadge(p.shift)} ${shiftLabels[p.shift] || p.shift}</td>
            <td>${statusCell}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  const gateCard = document.getElementById('gate-checkin-card');
  if (showGateCard) {
    gateCard.style.display = 'block';
    refreshGateCheckinStatus();
  } else {
    gateCard.style.display = 'none';
  }
}

async function confirmShift(date, status) {
  const res = await fetch('/api/staff/confirm-shift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, status }),
  });

  if (res.ok) {
    const data = await res.json();
    const message = status === 'declined'
      ? data.reassignment
        ? `Shift declined. Reassigned to ${data.reassignment.name}.`
        : 'Shift declined. No matching N-shift replacement was available.'
      : 'Shift confirmed.';
    await loadPendingConfirm();
    await loadSchedule();
    await loadNotifications();
    document.getElementById('confirm-list').insertAdjacentHTML(
      'afterbegin',
      `<div class="alert alert-success">${message}</div>`
    );
    return;
  }

  const data = await res.json();
  document.getElementById('confirm-list').insertAdjacentHTML(
    'afterbegin',
    `<div class="alert alert-error">${data.error || 'Could not update confirmation.'}</div>`
  );
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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function fmtDateTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function renderCommunityMedia(media) {
  if (!media || !media.length) return '';
  return `<div class="community-media-grid">${media.map(item => {
    if (item.type === 'video') {
      return `<video class="community-media" src="${item.url}" controls preload="metadata"></video>`;
    }
    return `<img class="community-media" src="${item.url}" alt="${escapeHtml(item.name || 'Community image')}">`;
  }).join('')}</div>`;
}

function renderCommunityPosts(posts) {
  const feed = document.getElementById('community-feed');
  if (!posts.length) {
    feed.innerHTML = '<div class="empty-state">No community posts yet.</div>';
    return;
  }

  feed.innerHTML = posts.map(post => `
    <article class="community-post ${post.isAlert ? 'is-alert' : ''}">
      <div class="community-post-head">
        <div>
          <div class="community-author">${escapeHtml(post.authorName)}</div>
          <div class="community-meta">${fmtDateTime(post.createdAt)} · ${post.target === 'all' ? 'Everyone' : escapeHtml(post.target)}</div>
        </div>
        ${post.isAlert ? '<span class="community-alert-badge">Alert</span>' : ''}
      </div>
      ${post.text ? `<div class="community-text">${escapeHtml(post.text).replace(/\n/g, '<br>')}</div>` : ''}
      ${renderCommunityMedia(post.media)}
      <div class="community-reactions">
        <button class="btn btn-outline btn-sm ${post.myReaction === 'up' ? 'reaction-active' : ''}" onclick="reactCommunity(${post.id}, 'up')">👍 ${post.reactionCounts.up}</button>
        <button class="btn btn-outline btn-sm ${post.myReaction === 'down' ? 'reaction-active' : ''}" onclick="reactCommunity(${post.id}, 'down')">👎 ${post.reactionCounts.down}</button>
      </div>
    </article>
  `).join('');
}

let staffCommunityFilter = 'posts';
let staffCommunityPolls = [];

function setStaffCommunityFilter(filter) {
  staffCommunityFilter = filter;
  document.getElementById('staff-feed-filter-posts').classList.toggle('active', filter === 'posts');
  document.getElementById('staff-feed-filter-polls').classList.toggle('active', filter === 'polls');
  document.getElementById('community-feed').innerHTML = '<div class="empty-state">Loading...</div>';
  if (filter === 'posts') loadCommunityFeed();
  else renderStaffCommunityPolls();
}

async function loadCommunityFeed() {
  const res = await fetch('/api/community');
  if (!res.ok) return;
  renderCommunityPosts(await res.json());
}

async function reactCommunity(postId, reaction) {
  const res = await fetch(`/api/community/${postId}/reaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reaction })
  });
  if (res.ok) loadCommunityFeed();
}

async function loadStaffCommunityPolls() {
  const res = await fetch('/api/community/polls');
  if (!res.ok) return;
  staffCommunityPolls = await res.json();
  if (staffCommunityFilter === 'polls') renderStaffCommunityPolls();
}

async function voteStaffPoll(pollId, optionId) {
  const res = await fetch(`/api/community/poll/${pollId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ optionId })
  });
  if (res.ok) {
    const data = await res.json();
    const idx = staffCommunityPolls.findIndex(p => p.id === data.poll.id);
    if (idx !== -1) staffCommunityPolls[idx] = data.poll;
    renderStaffCommunityPolls();
  } else {
    const data = await res.json();
    document.getElementById('community-feed').insertAdjacentHTML(
      'afterbegin',
      `<div class="alert alert-error">${data.error || 'Vote failed.'}</div>`
    );
  }
}

function renderStaffCommunityPolls() {
  const feed = document.getElementById('community-feed');
  if (!staffCommunityPolls.length) {
    feed.innerHTML = '<div class="empty-state">No polls yet.</div>';
    return;
  }
  feed.innerHTML = staffCommunityPolls.map(poll => {
    const total = poll.totalVotes;
    const isActive = poll.status === 'active';
    const expiresIn = isActive ? Math.max(0, Math.round((new Date(poll.expiresAt) - Date.now()) / 60000)) : 0;
    const hasVoted = poll.votedOptionId !== null;
    return `
      <article class="community-post ${poll.isAlert ? 'is-alert' : ''}">
        <div class="community-post-head">
          <div>
            <div class="community-author">${escapeHtml(poll.authorName)}</div>
            <div class="community-meta">${fmtDateTime(poll.createdAt)} · ${poll.target === 'all' ? 'Everyone' : escapeHtml(poll.target)} ${isActive ? `· Expires in ${expiresIn}m` : '· Closed'}</div>
          </div>
          <span class="community-alert-badge" style="background:${isActive ? 'var(--success)' : 'var(--muted)'};">${isActive ? 'Active' : 'Closed'}</span>
        </div>
        <div style="font-weight:600;font-size:15px;margin-bottom:12px;">${escapeHtml(poll.question)}</div>
        ${poll.options.map(opt => {
          const pct = total > 0 ? Math.round((poll.counts[opt.id] || 0) / total * 100) : 0;
          const isWinner = total > 0 && (poll.counts[opt.id] || 0) === Math.max(...Object.values(poll.counts));
          if (hasVoted || !isActive) {
            return `
              <div style="margin-bottom:8px;${poll.votedOptionId === opt.id ? 'font-weight:600;' : ''}">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;">
                  <span>${escapeHtml(opt.text)} ${poll.votedOptionId === opt.id ? '✓' : ''}</span>
                  <span>${poll.counts[opt.id] || 0} (${pct}%)</span>
                </div>
                <div style="height:8px;background:var(--bg);border-radius:4px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${isWinner ? 'var(--success)' : 'var(--primary-light)'};border-radius:4px;transition:width 0.3s;"></div>
                </div>
              </div>
            `;
          }
          return `
            <div style="margin-bottom:6px;">
              <button class="btn btn-outline btn-sm" style="width:100%;text-align:left;justify-content:flex-start;padding:8px 12px;" onclick="voteStaffPoll(${poll.id}, ${opt.id})">
                ${escapeHtml(opt.text)}
              </button>
            </div>
          `;
        }).join('')}
        <div style="font-size:12px;color:var(--muted);margin-top:8px;">${total} vote${total === 1 ? '' : 's'} ${hasVoted ? '· You voted' : ''}</div>
      </article>
    `;
  }).join('');
}

init();
