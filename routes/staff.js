const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { configureWebPush } = require('../services/pushNotifications');

const router = express.Router();

router.use(requireAuth);

router.get('/schedule', async (req, res) => {
  try {
    const { from, to } = req.query;
    res.json(await db.staffSchedule(req.session.userId, from, to));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/confirm-shift', async (req, res) => {
  try {
    const { date, status } = req.body;
    if (!date || !['confirmed', 'declined'].includes(status)) {
      return res.status(400).json({ error: 'date and status required' });
    }
    const result = await db.confirmShift({ userId: req.session.userId, date, status });
    if (result === 'missing') return res.status(404).json({ error: 'No schedule for this date' });
    if (result === 'not-today') return res.status(400).json({ error: 'Only today\'s shift can be confirmed or declined' });
    if (result === 'blocked') return res.status(400).json({ error: 'Only A, B, C, and G shifts can be confirmed' });
    res.json({ success: true, reassignment: result.reassignment || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/leave-request', async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !reason) return res.status(400).json({ error: 'Date and reason required' });
    const created = await db.createLeave({ userId: req.session.userId, date, reason });
    if (!created) return res.status(409).json({ error: 'Leave already submitted for this date' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/my-leaves', async (req, res) => {
  try {
    res.json(await db.staffLeaves(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/my-attendance', async (req, res) => {
  try {
    res.json(await db.staffAttendance(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    res.json(await db.pendingNotifications(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/push-public-key', async (req, res) => {
  try {
    res.json({ publicKey: await configureWebPush() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/push-subscription', async (req, res) => {
  try {
    const saved = await db.savePushSubscription(req.session.userId, req.body.subscription);
    if (!saved) return res.status(400).json({ error: 'Valid push subscription required' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/push-subscription', async (req, res) => {
  try {
    await db.removePushSubscription(req.session.userId, req.body && req.body.endpoint);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const worker = await db.getWorker(req.session.userId);
    res.json(worker ? worker.user : null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/profile-change-request', async (req, res) => {
  try {
    const result = await db.createProfileChangeRequest(req.session.userId, req.body);
    if (result === 'missing') return res.status(404).json({ error: 'Profile not found' });
    if (result === 'invalid') return res.status(400).json({ error: 'Name, phone, email, and designation are required' });
    if (result === 'no-change') return res.status(400).json({ error: 'No profile changes were submitted' });
    if (result === 'duplicate-email') return res.status(409).json({ error: 'Email already exists' });
    res.json({ success: true, request: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/profile-change-requests', async (req, res) => {
  try {
    res.json(await db.staffProfileChangeRequests(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports= router;