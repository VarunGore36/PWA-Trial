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
async function logout() {
  if (!(await confirmLogout())) return;
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
}

let allWorkers = [];
let scheduleMode = 'window';
let scheduleDays = 3;

function showTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');

  const activeBtn = btn || [...document.querySelectorAll('.tab-btn')]
    .find(item => item.getAttribute('onclick') && item.getAttribute('onclick').includes(`'${name}'`));
  if (activeBtn) activeBtn.classList.add('active');

  if (name === 'schedule') loadScheduleView();
  if (name === 'leaves') loadLeaves();
  if (name === 'profile-requests') loadProfileRequests();
  if (name === 'community') loadCommunityFeed();
}

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const me = await res.json();
  if (me.role !== 'admin') { window.location.href = '/staff'; return; }
  document.getElementById('admin-name').textContent = me.name;
  setDefaultDates();
  await loadWorkers();
  await loadStats();
}

async function loadStats() {
  const res = await fetch('/api/admin/dashboard-stats');
  if (!res.ok) return;
  const d = await res.json();
  document.getElementById('s-workers').textContent = d.totalWorkers;
  document.getElementById('s-leaves').textContent = d.pendingLeaves;
  document.getElementById('s-confirm').textContent = d.pendingConfirm;
  document.getElementById('s-today').textContent = d.todayShifts;
}

async function loadWorkers() {
  const res = await fetch('/api/admin/workers');
  if (!res.ok) return;
  allWorkers = await res.json();
  renderWorkers(allWorkers);
}

function searchWorkers() {
  const q = document.getElementById('worker-search').value.toLowerCase();
  renderWorkers(allWorkers.filter(w => w.name.toLowerCase().includes(q)));
}

function renderWorkers(workers) {
  const container = document.getElementById('worker-list');
  if (!workers.length) {
    container.innerHTML = '<div class="empty-state">No workers found.</div>';
    return;
  }
  container.innerHTML = workers.map(w => `
    <div class="worker-item" onclick="openWorker(${w.id})">
      <div>
        <div class="worker-name">${w.name}</div>
        <div class="worker-desig">Worker ID: ${w.id} &nbsp;·&nbsp; ${w.designation || ''} &nbsp;·&nbsp; ${w.ssid} &nbsp;·&nbsp; ${w.email}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);">${w.phone || ''}</div>
    </div>
  `).join('');
}

function openWorker(id) {
  window.location.href = `/worker-detail?id=${id}`;
}

function setDefaultDates() {
  const start = todayStr();
  document.getElementById('sched-from').value = start;
  document.getElementById('sched-to').value = addDays(start, 2);
}

function setScheduleWindow(start, days = 3) {
  scheduleDays = days;
  document.getElementById('sched-from').value = start;
  document.getElementById('sched-to').value = addDays(start, days - 1);
}

function moveScheduleWindow(delta) {
  scheduleMode = 'window';
  setScheduleWindow(addDays(document.getElementById('sched-from').value, delta), 3);
  loadScheduleView();
}

function openStatView(type) {
  if (type === 'workers') {
    showTab('workers');
    return;
  }
  if (type === 'leaves') {
    showTab('leaves');
    return;
  }
  if (type === 'today') {
    scheduleMode = 'today';
    document.getElementById('sched-designation').value = 'all';
    setScheduleWindow(todayStr(), 1);
    showTab('schedule');
    return;
  }
  if (type === 'unconfirmed') {
    scheduleMode = 'unconfirmed';
    document.getElementById('sched-designation').value = 'all';
    setScheduleWindow(todayStr(), 3);
    showTab('schedule');
  }
}

async function loadScheduleView() {
  const from = document.getElementById('sched-from').value;
  const to = document.getElementById('sched-to').value || addDays(from, scheduleDays - 1);
  const designation = document.getElementById('sched-designation').value;
  if (!from || !to) return;

  if (scheduleMode !== 'today' && scheduleMode !== 'unconfirmed') {
    scheduleMode = 'window';
    document.getElementById('sched-to').value = addDays(from, 2);
  }

  const finalTo = document.getElementById('sched-to').value || to;
  const res = await fetch(`/api/admin/all-schedules?from=${from}&to=${finalTo}`);
  const rows = await res.json();
  const wrap = document.getElementById('sched-table-wrap');
  let filteredRows = designation === 'all' ? rows : rows.filter(r => r.designation === designation);

  if (scheduleMode === 'unconfirmed') {
    filteredRows = filteredRows.filter(r => ['A', 'B', 'C', 'G'].includes(r.shift) && r.confirmed !== 'confirmed');
    renderUnconfirmedRows(filteredRows, wrap);
    return;
  }

  renderScheduleGrid(filteredRows, wrap);
}

function renderUnconfirmedRows(rows, wrap) {
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state">No unconfirmed shifts in this view.</div>';
    return;
  }

  wrap.innerHTML = `
    <table class="schedule-table">
      <thead><tr><th>Date</th><th>Worker</th><th>Designation</th><th>Shift</th><th>Status</th></tr></thead>
      <tbody>${rows.map(r => `
        <tr>
          <td>${fmtDate(r.date)}</td>
          <td><strong>${r.name}</strong></td>
          <td>${r.designation || '-'}</td>
          <td>${shiftBadge(r.shift)}</td>
          <td>${r.confirmed || 'pending'}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderScheduleGrid(rows, wrap) {
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty-state">No schedule data for this view.</div>';
    return;
  }

  const dates = [...new Set(rows.map(r => r.date))].sort();
  const workers = {};
  rows.forEach(r => {
    if (!workers[r.user_id]) workers[r.user_id] = { name: r.name, desig: r.designation, shifts: {} };
    workers[r.user_id].shifts[r.date] = { shift: r.shift, confirmed: r.confirmed };
  });

  const title = scheduleMode === 'today'
    ? `Today's shifts - ${fmtDate(dates[0])}`
    : `${fmtDate(dates[0])} to ${fmtDate(dates[dates.length - 1])}`;

  const dateHeaders = dates.map(d => {
    const dt = new Date(d + 'T00:00:00');
    return `<th>${dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}<br><small>${['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()]}</small></th>`;
  }).join('');

  const bodyRows = Object.values(workers).map(w => {
    const cells = dates.map(d => {
      const entry = w.shifts[d];
      if (!entry) return '<td>-</td>';
      const confirmed = entry.confirmed === 'confirmed' ? 'OK' : entry.confirmed === 'declined' ? 'No' : '';
      return `<td>${shiftBadge(entry.shift)} <span style="font-size:10px;color:var(--muted)">${confirmed}</span></td>`;
    }).join('');
    return `<tr><td class="worker-sticky"><strong>${w.name}</strong><br><span style="font-size:11px;color:var(--muted)">${w.desig}</span></td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="schedule-range-title">${title}</div>
    <table class="schedule-table">
      <thead><tr><th class="worker-sticky">Worker</th>${dateHeaders}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

async function loadLeaves() {
  const res = await fetch('/api/admin/workers');
  const workers = await res.json();
  const leavesContainer = document.getElementById('leaves-table');
  leavesContainer.innerHTML = '<div class="empty-state">Loading...</div>';

  let allLeaves = [];
  for (const w of workers) {
    const r = await fetch(`/api/admin/worker/${w.id}`);
    if (!r.ok) continue;
    const d = await r.json();
    d.leaves.forEach(l => allLeaves.push({ ...l, workerName: w.name }));
  }

  const pending = allLeaves.filter(l => l.status === 'pending');
  const others = allLeaves.filter(l => l.status !== 'pending');
  const display = [...pending, ...others];

  if (!display.length) {
    leavesContainer.innerHTML = '<div class="empty-state">No leave requests.</div>';
    return;
  }

  leavesContainer.innerHTML = `
    <table>
      <thead><tr><th>Worker</th><th>Date</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${display.map(l => `
          <tr>
            <td>${l.workerName}</td>
            <td>${fmtDate(l.date)}</td>
            <td>${l.reason}</td>
            <td>${statusBadge(l.status)}</td>
            <td>
              ${l.status === 'pending' ? `
                <button class="btn btn-success btn-sm" onclick="leaveAction(${l.id},'approved')">Approve</button>
                <button class="btn btn-danger btn-sm" onclick="leaveAction(${l.id},'rejected')" style="margin-left:4px;">Reject</button>
              ` : '-'}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function leaveAction(leaveId, action) {
  const res = await fetch('/api/admin/leave-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leave_id: leaveId, action }),
  });
  if (res.ok) {
    loadLeaves();
    loadStats();
  }
}

async function loadProfileRequests() {
  const res = await fetch('/api/admin/profile-change-requests');
  if (!res.ok) return;
  const requests = await res.json();
  const container = document.getElementById('profile-requests-table');

  if (!requests.length) {
    container.innerHTML = '<div class="empty-state">No pending profile changes.</div>';
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Worker</th><th>Requested Changes</th><th>Action</th></tr></thead>
      <tbody>
        ${requests.map(r => `
          <tr>
            <td>
              <strong>${r.workerName}</strong><br>
              <span style="font-size:12px;color:var(--muted);">SSID: ${r.workerSsid}</span>
            </td>
            <td>${Object.keys(r.changes).map(key => `
              <div style="margin-bottom:6px;">
                <strong>${key}</strong>: ${r.current[key] || '-'} &rarr; ${r.requested[key] || '-'}
              </div>
            `).join('')}</td>
            <td>
              <button class="btn btn-success btn-sm" onclick="profileRequestAction(${r.id}, 'approved')">Approve</button>
              <button class="btn btn-danger btn-sm" onclick="profileRequestAction(${r.id}, 'rejected')" style="margin-left:4px;">Reject</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function profileRequestAction(id, action) {
  const res = await fetch(`/api/admin/profile-change-requests/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (res.ok) {
    loadProfileRequests();
    loadWorkers();
  }
}

async function createWorker() {
  const name = document.getElementById('new-name').value.trim();
  const phone = document.getElementById('new-phone').value.trim();
  const ssid = document.getElementById('new-ssid').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const designation = document.getElementById('new-desig').value;
  const password = document.getElementById('new-password').value;

  const msgEl = document.getElementById('create-msg');
  msgEl.innerHTML = '';

  if (!name || !phone || !ssid || !email || !password) {
    msgEl.innerHTML = '<div class="alert alert-error">Name, phone number, SSID, email, and password are required.</div>';
    return;
  }

  const res = await fetch('/api/admin/create-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, phone, ssid, email, designation, password }),
  });
  const data = await res.json();

  if (res.ok) {
    msgEl.innerHTML = '<div class="alert alert-success">Worker created successfully.</div>';
    document.getElementById('new-name').value = '';
    document.getElementById('new-phone').value = '';
    document.getElementById('new-ssid').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    loadWorkers();
    loadStats();
  } else {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error}</div>`;
  }
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
        <span>👍 ${post.reactionCounts.up}</span>
        <span>👎 ${post.reactionCounts.down}</span>
      </div>
    </article>
  `).join('');
}

async function loadCommunityFeed() {
  const res = await fetch('/api/community');
  if (!res.ok) return;
  renderCommunityPosts(await res.json());
}

async function createCommunityPost() {
  const msgEl = document.getElementById('community-msg');
  msgEl.innerHTML = '';

  const formData = new FormData();
  formData.append('text', document.getElementById('community-text').value.trim());
  formData.append('target', document.getElementById('community-target').value);
  formData.append('isAlert', document.getElementById('community-alert').checked ? 'true' : 'false');

  const files = [...document.getElementById('community-media').files].slice(0, 3);
  files.forEach(file => formData.append('media', file));

  const res = await fetch('/api/community', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error || 'Community post failed.'}</div>`;
    return;
  }

  document.getElementById('community-text').value = '';
  document.getElementById('community-media').value = '';
  document.getElementById('community-alert').checked = false;
  msgEl.innerHTML = '<div class="alert alert-success">Community post published.</div>';
  loadCommunityFeed();
}

init();
