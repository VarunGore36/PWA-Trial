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
  if (name === 'leaves') loadLeaves();
  if (name === 'attendance') loadAttendance();
  if (name === 'confirm') loadPendingConfirm();
  if (name === 'profile') loadProfile();
  if (name === 'community') loadCommunityFeed();
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
  container.innerHTML = `
    <div class="alert alert-info">You will receive a push notification 1 hour before each confirmable shift.</div>
    <table>
      <thead><tr><th>Date</th><th>Day</th><th>Shift</th><th>Confirmation</th></tr></thead>
      <tbody>
        ${week.map(p => {
          const dt = new Date(p.date + 'T00:00:00');
          const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
          const confirmable = ['A', 'B', 'C', 'G'].includes(p.shift);
          const isToday = p.date === todayStr();
          const confirmationCell = !confirmable
            ? '-'
            : !isToday
              ? '<span style="font-size:12px;color:var(--muted);">Unavailable</span>'
            : p.confirmation && p.confirmation !== 'pending'
              ? statusBadge(p.confirmation)
              : `
                <button class="btn btn-success btn-sm" onclick="confirmShift('${p.date}', 'confirmed')">Confirm</button>
                <button class="btn btn-danger btn-sm" onclick="confirmShift('${p.date}', 'declined')" style="margin-left:4px;">Decline</button>
              `;
          return `<tr>
            <td>${fmtDate(p.date)}</td>
            <td>${dayNames[dt.getDay()]}</td>
            <td>${shiftBadge(p.shift)} ${shiftLabels[p.shift] || p.shift}</td>
            <td>${confirmationCell}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
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

init();
