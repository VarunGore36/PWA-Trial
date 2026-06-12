const webPush = require('web-push');
const db = require('../db');

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@iiserb.ac.in';
const CHECK_INTERVAL_MS = 60 * 1000;

let started = false;

function subscriptionFromRecord(record) {
  return {
    endpoint: record.endpoint,
    keys: record.keys
  };
}

async function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const keys = publicKey && privateKey
    ? { publicKey, privateKey }
    : await db.ensurePushVapidKeys(() => webPush.generateVAPIDKeys());

  webPush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  return keys.publicKey;
}

function formatStartTime(startAt) {
  return new Date(startAt).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata'
  });
}

async function sendDueShiftNotifications() {
  await configureWebPush();
  const dueNotifications = await db.getDueShiftNotifications(new Date());

  for (const notification of dueNotifications) {
    const payload = JSON.stringify({
      title: 'Shift starts in 1 hour',
      body: `${notification.label} shift starts at ${formatStartTime(notification.startAt)} IST. Confirm or decline now.`,
      url: '/staff',
      tag: `shift-${notification.userId}-${notification.date}-${notification.shift}`,
      requireInteraction: true,
      actions: [
        { action: 'confirmed', title: 'Confirm' },
        { action: 'declined', title: 'Decline' }
      ],
      data: {
        date: notification.date,
        shift: notification.shift
      }
    });

    let delivered = false;
    for (const subscription of notification.subscriptions) {
      try {
        await webPush.sendNotification(subscriptionFromRecord(subscription), payload);
        delivered = true;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          await db.removePushSubscriptionByEndpoint(subscription.endpoint);
        } else {
          console.error('Push notification failed:', error.message);
        }
      }
    }

    if (delivered) {
      await db.markShiftNotificationSent(notification.key);
    }
  }
}

async function sendCommunityAlert({ title, body, target }) {
  await configureWebPush();
  const recipients = await db.communityRecipients(target || 'all');
  const subscriptions = await db.getPushSubscriptionsForUsers(recipients.map(user => user.id));
  const payload = JSON.stringify({
    title: title || 'Community alert',
    body: body || 'New alert from admin.',
    url: '/staff',
    tag: `community-alert-${Date.now()}`,
    requireInteraction: true
  });

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscriptionFromRecord(subscription), payload);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await db.removePushSubscriptionByEndpoint(subscription.endpoint);
      } else {
        console.error('Community alert push failed:', error.message);
      }
    }
  }
}

async function sendPushToUser(userId, payload) {
  await configureWebPush();
  const subscriptions = await db.getPushSubscriptionsForUsers([userId]);
  if (!subscriptions.length) return false;
  let delivered = false;
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscriptionFromRecord(subscription), JSON.stringify(payload));
      delivered = true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await db.removePushSubscriptionByEndpoint(subscription.endpoint);
      } else {
        console.error('Push failed for user ' + userId + ':', error.message);
      }
    }
  }
  return delivered;
}

async function sendLeaveStatusNotification(userId, status, date) {
  await sendPushToUser(userId, {
    title: 'Leave ' + status,
    body: 'Your leave request for ' + date + ' has been ' + status + '.',
    url: '/staff',
    tag: 'leave-' + status + '-' + userId + '-' + date
  });
}

async function sendNewLeaveRequestToAdmin(adminId, workerName, date, reason) {
  await sendPushToUser(adminId, {
    title: 'New Leave Request',
    body: workerName + ' requested leave on ' + date + ': ' + reason,
    url: '/admin',
    tag: 'leave-request-' + Date.now(),
    requireInteraction: true
  });
}

async function sendShiftReassignmentNotification(userId, date, shift, reason) {
  await sendPushToUser(userId, {
    title: 'Shift Reassigned',
    body: 'You have been assigned shift ' + shift + ' on ' + date + ' due to ' + reason + '.',
    url: '/staff',
    tag: 'reassign-' + userId + '-' + date,
    requireInteraction: true
  });
}

async function sendNewCommunityPostNotification(userId, authorName, text, isAlert) {
  await sendPushToUser(userId, {
    title: isAlert ? 'Community Alert' : 'New Community Post',
    body: authorName + ': ' + (text || '').substring(0, 100),
    url: '/staff',
    tag: 'community-post-' + Date.now(),
    requireInteraction: isAlert
  });
}

async function sendNewPollNotification(userId, authorName, question) {
  await sendPushToUser(userId, {
    title: 'New Poll',
    body: authorName + ' created a poll: ' + (question || '').substring(0, 80),
    url: '/staff',
    tag: 'poll-' + Date.now()
  });
}

function startShiftReminderLoop() {
  if (started) return;
  started = true;
  configureWebPush().catch(error => console.error('Push setup failed:', error.message));
  sendDueShiftNotifications().catch(error => console.error('Shift reminder check failed:', error.message));
  setInterval(() => {
    sendDueShiftNotifications().catch(error => console.error('Shift reminder check failed:', error.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  configureWebPush,
  sendCommunityAlert,
  sendDueShiftNotifications,
  sendPushToUser,
  sendLeaveStatusNotification,
  sendNewLeaveRequestToAdmin,
  sendShiftReassignmentNotification,
  sendNewCommunityPostNotification,
  sendNewPollNotification,
  startShiftReminderLoop
};
