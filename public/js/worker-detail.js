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
function isNonConfirmableShift(shift) {
  return ['W', 'N', 'N_A', 'N_B', 'N_C', 'F'].includes(String(shift || '').toUpperCase());
}
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
}

const params = new URLSearchParams(window.location.search);
const workerId = params.get('id');

let workerData = null;

async function init() {
  const me = await fetch('/api/me');
  if (!me.ok) { window.location.href = '/'; return; }
  const meData = await me.json();
  if (meData.role !== 'admin') { window.location.href = '/staff'; return; }

  if (!workerId) { window.location.href = '/admin'; return; }

  const res = await fetch(`/api/admin/worker/${workerId}`);
  if (!res.ok) { window.location.href = '/admin'; return; }

  workerData = await res.json();
  renderHeader();
  renderSchedule();
  renderConfirmations();
  renderLeaves();
  fillProfileForm();
}

function renderHeader() {
  const u = workerData.user;
  const sc = workerData.shiftCounts;
  document.title = `${u.name} - IISER Shift`;
  document.getElementById('worker-header').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
      <div>
        <h2 style="font-size:20px;font-weight:700;color:var(--primary);">${u.name}</h2>
        <p style="color:var(--muted);font-size:13px;">${u.designation || '-'} &nbsp;·&nbsp; ${u.email}</p>
        <p style="color:var(--muted);font-size:13px;">Worker ID: ${u.id} &nbsp;·&nbsp; SSID: ${u.ssid || '-'} &nbsp;·&nbsp; Phone: ${u.phone || '-'}</p>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
        <button class="btn btn-danger btn-sm" onclick="openRemoveWorkerModal()">Remove Worker</button>
        ${['A','B','C','W','N','F'].map(s => `
          <div style="text-align:center;">
            ${shiftBadge(s)}
            <div style="font-size:12px;color:var(--muted);margin-top:3px;">${sc[s] || 0}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function fillProfileForm() {
  const u = workerData.user;
  document.getElementById('profile-name').value = u.name || '';
  document.getElementById('profile-phone').value = u.phone || '';
  document.getElementById('profile-ssid').value = u.ssid || '';
  document.getElementById('profile-email').value = u.email || '';
  document.getElementById('profile-designation').value = u.designation || 'SG';
}

async function saveProfileEdit() {
  const msgEl = document.getElementById('profile-edit-msg');
  msgEl.innerHTML = '';

  const payload = {
    name: document.getElementById('profile-name').value.trim(),
    phone: document.getElementById('profile-phone').value.trim(),
    ssid: document.getElementById('profile-ssid').value.trim(),
    email: document.getElementById('profile-email').value.trim(),
    designation: document.getElementById('profile-designation').value
  };

  const res = await fetch(`/api/admin/worker/${workerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error || 'Profile update failed.'}</div>`;
    return;
  }

  const r2 = await fetch(`/api/admin/worker/${workerId}`);
  workerData = await r2.json();
  renderHeader();
  fillProfileForm();
  msgEl.innerHTML = '<div class="alert alert-success">Worker details updated.</div>';
}

function openRemoveWorkerModal() {
  document.getElementById('remove-worker-msg').innerHTML = '';
  document.getElementById('remove-reason').value = '';
  document.getElementById('remove-worker-modal').classList.add('open');
}

function closeRemoveWorkerModal() {
  document.getElementById('remove-worker-modal').classList.remove('open');
}

async function confirmRemoveWorker() {
  const reason = document.getElementById('remove-reason').value.trim();
  const msgEl = document.getElementById('remove-worker-msg');
  msgEl.innerHTML = '';

  if (!reason) {
    msgEl.innerHTML = '<div class="alert alert-error">Please state a reason before removing this worker.</div>';
    return;
  }

  const res = await fetch(`/api/admin/worker/${workerId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, confirm: 'REMOVE' }),
  });
  const data = await res.json();

  if (!res.ok) {
    msgEl.innerHTML = `<div class="alert alert-error">${data.error || 'Worker removal failed.'}</div>`;
    return;
  }

  window.location.href = '/admin';
}

function renderSchedule() {
  const schedules = workerData.schedules;
  const confirmMap = {};
  workerData.confirmations.forEach(c => { confirmMap[c.date] = c.status; });

  if (!schedules.length) {
    document.getElementById('schedule-table').innerHTML = '<div class="empty-state">No schedule data.</div>';
    return;
  }

  let html = '<table><thead><tr><th>Date</th><th>Day</th><th>Shift</th><th>Confirmation</th></tr></thead><tbody>';
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  schedules.forEach(s => {
    const dt = new Date(s.date + 'T00:00:00');
    const dayName = days[dt.getDay()];
    const confirm = confirmMap[s.date];
    const confirmCell = isNonConfirmableShift(s.shift) ? '-'
      : (confirm ? statusBadge(confirm) : statusBadge('pending'));

    html += `<tr>
      <td>${fmtDate(s.date)}</td>
      <td>${dayName}</td>
      <td>${shiftBadge(s.shift)}</td>
      <td>${confirmCell}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  document.getElementById('schedule-table').innerHTML = html;
}

function renderConfirmations() {
  const confirmations = workerData.confirmations;
  if (!confirmations.length) {
    document.getElementById('confirm-table').innerHTML = '<div class="empty-state">No confirmation data.</div>';
    return;
  }
  document.getElementById('confirm-table').innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Status</th></tr></thead>
      <tbody>${confirmations.map(c => `
        <tr><td>${fmtDate(c.date)}</td><td>${statusBadge(c.status)}</td></tr>
      `).join('')}</tbody>
    </table>
  `;
}

function renderLeaves() {
  const leaves = workerData.leaves;
  const container = document.getElementById('leaves-table');
  if (!leaves.length) {
    container.innerHTML = '<div class="empty-state">No leave requests.</div>';
    return;
  }
  container.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${fmtDate(l.date)}</td>
          <td>${l.reason}</td>
          <td>${statusBadge(l.status)}</td>
          <td>${l.status === 'pending' ? `
            <button class="btn btn-success btn-sm" onclick="leaveAction(${l.id},'approved')">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="leaveAction(${l.id},'rejected')" style="margin-left:4px;">Reject</button>
          ` : '-'}</td>
        </tr>
      `).join('')}</tbody>
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
    const r2 = await fetch(`/api/admin/worker/${workerId}`);
    workerData = await r2.json();
    renderLeaves();
    renderHeader();
  }
}

async function saveEdit() {
  const date = document.getElementById('edit-date').value;
  const shift = document.getElementById('edit-shift').value;
  const msgEl = document.getElementById('edit-msg');
  msgEl.innerHTML = '';

  if (!date) {
    msgEl.innerHTML = '<div class="alert alert-error">Please select a date.</div>';
    return;
  }

  const res = await fetch('/api/admin/update-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: workerId, date, shift }),
  });

  if (res.ok) {
    msgEl.innerHTML = '<div class="alert alert-success">Schedule updated.</div>';
    const r2 = await fetch(`/api/admin/worker/${workerId}`);
    workerData = await r2.json();
    renderSchedule();
    renderHeader();
  } else {
    const d = await res.json();
    msgEl.innerHTML = `<div class="alert alert-error">${d.error}</div>`;
  }
}

init();
