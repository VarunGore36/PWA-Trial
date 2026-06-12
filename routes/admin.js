const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendLeaveStatusNotification, sendShiftReassignmentNotification } = require('../services/pushNotifications');

const router = express.Router();

router.use(requireAdmin);

router.get('/workers', async (req, res) => {
  try {
    const workers = await db.listWorkers(req.query.search || '');
    res.json(workers);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/worker/:id', async (req, res) => {
  try {
    const worker = await db.getWorker(req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json(worker);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/worker/:id', async (req, res) => {
  try {
    const { reason, confirm } = req.body;
    if (confirm !== 'REMOVE') {
      return res.status(400).json({ error: 'Removal confirmation is required' });
    }
    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ error: 'Removal reason is required' });
    }

    const removed = await db.removeWorker({
      workerId: req.params.id,
      reason,
      removedBy: req.session.userId
    });
    if (!removed) return res.status(404).json({ error: 'Worker not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/worker/:id', async (req, res) => {
  try {
    const result = await db.updateWorkerProfile(req.params.id, req.body);
    if (result === 'missing') return res.status(404).json({ error: 'Worker not found' });
    if (result === 'invalid') return res.status(400).json({ error: 'Name, phone, SSID, email, and designation are required' });
    if (result === 'duplicate-ssid') return res.status(409).json({ error: 'SSID already exists' });
    if (result === 'duplicate-email') return res.status(409).json({ error: 'Email already exists' });
    res.json({ success: true, user: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/profile-change-requests', async (req, res) => {
  try {
    res.json(await db.getProfileChangeRequests(req.query.status || 'pending'));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/profile-change-requests/:id/action', async (req, res) => {
  try {
    const result = await db.decideProfileChangeRequest({
      requestId: req.params.id,
      action: req.body.action,
      decidedBy: req.session.userId
    });
    if (result === 'missing') return res.status(404).json({ error: 'Request not found' });
    if (result === 'closed') return res.status(409).json({ error: 'Request is already closed' });
    if (result === 'invalid') return res.status(400).json({ error: 'Action must be approved or rejected' });
    if (result === 'worker-missing') return res.status(404).json({ error: 'Worker no longer exists' });
    if (result === 'duplicate-email') return res.status(409).json({ error: 'Email already exists' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/update-schedule', async (req, res) => {
  try {
    const { user_id, date, shift } = req.body;
    if (!user_id || !date || !shift) return res.status(400).json({ error: 'user_id, date, shift required' });
    const normalizedShift = String(shift).toUpperCase();
    if (!['A', 'B', 'C', 'G', 'W', 'N', 'F'].includes(normalizedShift)) {
      return res.status(400).json({ error: 'Invalid shift' });
    }
    await db.setSchedule({ userId: user_id, date, shift: normalizedShift });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/leave-action', async (req, res) => {
  try {
    const { leave_id, action } = req.body;
    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'action must be approved or rejected' });
    }
    const result = await db.leaveAction({ leaveId: leave_id, action, adminId: req.session.userId });
    if (!result) return res.status(404).json({ error: 'Leave not found' });

    const leaves = await db.getAllLeaves();
    const leave = leaves.find(l => l.id === Number(leave_id));
    if (leave) {
      sendLeaveStatusNotification(leave.userId, action, leave.date)
        .catch(err => console.error('Failed to send leave notification:', err.message));
      if (action === 'approved' && result.reassignment && result.reassignment.userId) {
        sendShiftReassignmentNotification(
          result.reassignment.userId, leave.date, result.reassignment.assignedShift,
          'leave approved for ' + leave.workerName
        ).catch(err => console.error('Failed to send reassignment notification:', err.message));
      }
    }

    res.json({ success: true, reassignment: result.reassignment || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/activity-logs', async (req, res) => {
  try {
    res.json(await db.listAdminActivityLogs());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard-stats', async (req, res) => {
  try {
    res.json(await db.getDashboardStats());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/all-schedules', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required' });
    res.json(await db.getSchedulesForRange(from, to));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/monthly-report', async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const month = req.query.month || (new Date().getMonth() + 1);
    const rows = await db.getMonthlyAttendanceReport(year, month);

    const headers = ['Name', 'SSID', 'Designation', 'Date', 'Shift', 'Shift Start', 'Shift End', 'Confirmation', 'Pre-Confirmed At', 'Gate Arrived At', 'GPS Lat', 'GPS Lng', 'Distance From Gate (m)', 'Attendance', 'Leave Reason'];

    let csv = headers.join(',') + '\n';
    const esc = v => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    for (const row of rows) {
      csv += headers.map(h => esc(row[h === 'Distance From Gate (m)' ? 'gateDistance' : ({
        'Name': 'name', 'SSID': 'ssid', 'Designation': 'designation', 'Date': 'date', 'Shift': 'shift',
        'Shift Start': 'shiftStart', 'Shift End': 'shiftEnd', 'Confirmation': 'confirmation',
        'Pre-Confirmed At': 'preConfirmedAt', 'Gate Arrived At': 'gateConfirmedAt',
        'GPS Lat': 'gateLat', 'GPS Lng': 'gateLng', 'Attendance': 'attendance', 'Leave Reason': 'leaveReason'
      })[h] || h])).join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${year}-${String(month).padStart(2, '0')}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/create-user', async (req, res) => {
  try {
    const { name, phone, ssid, email, designation, password } = req.body;
    if (!name || !phone || !ssid || !email || !password) {
      return res.status(400).json({ error: 'Name, phone number, SSID, email, and password are required' });
    }
    const worker = await db.createWorker({ name, phone, ssid, email, designation, password });
    res.json({ success: true, id: worker.id });
  } catch (e) {
    if (e.code === 'DUPLICATE') return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
