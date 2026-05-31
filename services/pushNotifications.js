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
      title: 'Shift starts in 30 minutes',
      body: `${notification.label} shift starts at ${formatStartTime(notification.startAt)} IST.`,
      url: '/staff',
      tag: `shift-${notification.userId}-${notification.date}-${notification.shift}`,
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
    tag: `community-alert-${Date.now()}`
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
  startShiftReminderLoop
};
