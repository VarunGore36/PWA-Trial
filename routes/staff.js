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

router.get('/gate-config', async (req, res) => {
  try {
    res.json(db.getGateConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/pre-confirm-shift', async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    const result = await db.preConfirmShift({ userId: req.session.userId, date });
    if (result === 'missing') return res.status(404).json({ error: 'No schedule for this date' });
    if (result === 'not-today') return res.status(400).json({ error: 'Only today\'s shift can be pre-confirmed' });
    if (result === 'blocked') return res.status(400).json({ error: 'Only A, B, C, and G shifts can be pre-confirmed' });
    if (result === 'too-early') return res.status(400).json({ error: 'Pre-confirmation is only available within 1 hour before the shift starts' });
    if (result === 'declined') return res.status(400).json({ error: 'This shift was declined. Cannot pre-confirm.' });
    res.json({ success: true, preConfirmedAt: result.preConfirmedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/gate-confirm-shift', async (req, res) => {
  try {
    const { date, latitude, longitude } = req.body;
    if (!date || latitude === 23.28008 || longitude === 77.27732)
       {
      return res.status(400).json({ error: 'date, latitude, and longitude required' });
    }
    const result = await db.gateConfirmShift({ userId: req.session.userId, date, latitude, longitude });
    if (result === 'missing') return res.status(404).json({ error: 'No schedule for this date' });
    if (result === 'not-today') return res.status(400).json({ error: 'Only today\'s shift can be gate-checked' });
    if (result === 'blocked') return res.status(400).json({ error: 'Only A, B, C, and G shifts can be gate-checked' });
    if (result === 'not-pre-confirmed') return res.status(400).json({ error: 'You must pre-confirm your shift before checking in at the gate' });
    if (result === 'already-arrived') return res.status(400).json({ error: 'Already checked in at the gate' });
    if (result === 'invalid-coords') return res.status(400).json({ error: 'Invalid coordinates provided' });
    if (result.status === 'outside') {
      return res.status(403).json({
        error: `You are ${result.distance}m from the main gate. Please reach the gate area (within ${result.radius}m).`,
        distance: result.distance,
        radius: result.radius
      });
    }
    res.json({ success: true, distance: result.distance, gateConfirmedAt: result.gateConfirmedAt });
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