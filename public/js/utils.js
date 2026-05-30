function shiftBadge(shift) {
  const labels = { A: 'Morning', B: 'Noon', C: 'Evening', W: 'Weekly Off', N: 'No Work', F: 'Absent' };
  const s = (shift || 'N').toUpperCase();
  return `<span class="shift-badge shift-${s}">${s}</span>`;
}

function statusBadge(status) {
  return `<span class="badge badge-${status}">${status}</span>`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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
