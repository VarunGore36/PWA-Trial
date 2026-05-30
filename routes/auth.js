const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sendAdminResetEmail, sendStaffOtp } = require('../services/notifier');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { role, email, ssid, password } = req.body;
    if (!role || !password) return res.status(400).json({ error: 'Login type and password required' });
    if (!['admin', 'staff'].includes(role)) return res.status(400).json({ error: 'Invalid login type' });

    let user = null;
    if (role === 'admin') {
      if (!email) return res.status(400).json({ error: 'IISERB email and password required' });
      if (!email.toLowerCase().endsWith('@iiserb.ac.in')) {
        return res.status(403).json({ error: 'Admin email must be an @iiserb.ac.in address' });
      }
      user = await db.findAdminByEmail(email);
    } else {
      if (!ssid) return res.status(400).json({ error: 'SSID and password required' });
      user = await db.findUserBySsid(ssid);
    }

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (user.role !== role) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.name = user.name;

    res.json({
      success: true,
      role: user.role,
      name: user.name,
      userId: user.id,
      mustChangePassword: Boolean(user.mustChangePassword)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password required' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const result = await db.changePassword({
      userId: req.session.userId,
      currentPassword,
      newPassword
    });
    if (result === 'missing') return res.status(404).json({ error: 'Account not found' });
    if (result === 'invalid') return res.status(401).json({ error: 'Current password is incorrect' });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function makeResetCode() {
  return String(crypto.randomInt(100000, 1000000));
}

router.post('/request-password-reset', async (req, res) => {
  try {
    const { role, email, phone } = req.body;
    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ error: 'Login type is required' });
    }

    const user = role === 'admin'
      ? await db.findAdminByEmail(email)
      : await db.findStaffByPhone(phone);

    if (!user) {
      return res.status(404).json({
        error: role === 'admin'
          ? 'No admin account matched that email address'
          : 'No staff account matched that phone number'
      });
    }

    const code = makeResetCode();
    await db.createPasswordResetCode({
      userId: user.id,
      code,
      channel: role === 'admin' ? 'email' : 'sms'
    });

    const delivery = role === 'admin'
      ? await sendAdminResetEmail({ to: user.email, code, name: user.name })
      : await sendStaffOtp({ phone: user.phone, code });

    res.json({
      success: true,
      delivery,
      message: role === 'admin'
        ? 'Password reset code sent to registered email.'
        : 'OTP sent to registered phone number.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { role, email, phone, otp, password } = req.body;
    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ error: 'Login type is required' });
    }
    if (!otp || !password) {
      return res.status(400).json({ error: 'OTP and new password are required' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const result = await db.resetPasswordWithCode({
      role,
      identifier: role === 'admin' ? email : phone,
      code: otp,
      password
    });

    if (result === 'missing') return res.status(404).json({ error: 'Account not found' });
    if (result === 'missing-code') return res.status(404).json({ error: 'Request a new OTP first' });
    if (result === 'expired') return res.status(400).json({ error: 'OTP expired. Request a new one.' });
    if (result === 'invalid-code') return res.status(400).json({ error: 'Invalid OTP' });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  db.readDb()
    .then(data => {
      const user = data.users.find(item => item.id === req.session.userId);
      res.json({
        userId: req.session.userId,
        role: req.session.role,
        name: req.session.name,
        mustChangePassword: Boolean(user && user.mustChangePassword)
      });
    })
    .catch(e => res.status(500).json({ error: e.message }));
});

module.exports = router;
