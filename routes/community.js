const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendCommunityAlert, sendNewCommunityPostNotification, sendNewPollNotification } = require('../services/pushNotifications');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'community');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image and video files are allowed'));
  }
});

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    res.json(await db.listCommunityPosts(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', upload.array('media', 3), async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can post to community' });
    }

    const media = (req.files || []).map(file => ({
      url: `/uploads/community/${file.filename}`,
      type: file.mimetype.startsWith('video/') ? 'video' : 'image',
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size
    }));

    const created = await db.createCommunityPost({
      authorId: req.session.userId,
      text: req.body.text,
      isAlert: req.body.isAlert === 'true',
      target: req.body.target || 'all',
      media
    });

    if (created === 'empty') return res.status(400).json({ error: 'Text or media is required' });
    if (created === 'forbidden') return res.status(403).json({ error: 'Only admins can post to community' });

    if (created.isAlert) {
      await sendCommunityAlert({
        title: 'Community alert',
        body: created.text || 'New alert from admin.',
        target: created.target
      });
    }

    const recipients = await db.communityRecipients(created.target);
    for (const recipient of recipients) {
      if (recipient.id !== req.session.userId) {
        sendNewCommunityPostNotification(recipient.id, created.authorName, created.text, created.isAlert)
          .catch(err => console.error('Failed to send community notification:', err.message));
      }
    }

    res.json({ success: true, post: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/reaction', async (req, res) => {
  try {
    if (req.session.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can react' });
    }
    const result = await db.reactToCommunityPost({
      userId: req.session.userId,
      postId: req.params.id,
      reaction: req.body.reaction
    });

    if (result === 'missing') return res.status(404).json({ error: 'Post not found' });
    if (result === 'invalid') return res.status(400).json({ error: 'Reaction must be up or down' });
    res.json({ success: true, post: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/polls', async (req, res) => {
  try {
    res.json(await db.listPolls(req.session.userId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/poll', async (req, res) => {
  try {
    if (req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can create polls' });
    }
    const { question, options, target, durationMinutes, isAlert } = req.body;
    const result = await db.createPoll({
      authorId: req.session.userId,
      question,
      options: JSON.parse(options || '[]'),
      target: target || 'all',
      durationMinutes: Number(durationMinutes) || 1440,
      isAlert: isAlert === 'true' || isAlert === true
    });
    if (result === 'empty') return res.status(400).json({ error: 'Poll question is required' });
    if (result === 'too-few-options') return res.status(400).json({ error: 'At least 2 options are required' });
    if (result === 'too-many-options') return res.status(400).json({ error: 'Maximum 10 options allowed' });

    const recipients = await db.communityRecipients(result.target);
    for (const recipient of recipients) {
      if (recipient.id !== req.session.userId) {
        sendNewPollNotification(recipient.id, result.authorName, result.question)
          .catch(err => console.error('Failed to send poll notification:', err.message));
      }
    }

    res.json({ success: true, poll: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/poll/:id/vote', async (req, res) => {
  try {
    if (req.session.role !== 'staff') {
      return res.status(403).json({ error: 'Only staff can vote' });
    }
    const result = await db.votePoll({
      userId: req.session.userId,
      pollId: req.params.id,
      optionId: req.body.optionId
    });
    if (result === 'missing') return res.status(404).json({ error: 'Poll not found' });
    if (result === 'closed') return res.status(400).json({ error: 'This poll has ended' });
    if (result === 'invalid-option') return res.status(400).json({ error: 'Invalid option' });
    res.json({ success: true, poll: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
