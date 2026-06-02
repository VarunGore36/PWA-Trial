const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

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
