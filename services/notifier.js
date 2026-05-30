const fs = require('fs');
const path = require('path');

const LOG_PATH = path.join(__dirname, '..', 'data', 'password-reset-codes.log');

async function writeDevLog(entry) {
  const line = JSON.stringify({ ...entry, createdAt: new Date().toISOString() }) + '\n';
  await fs.promises.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.promises.appendFile(LOG_PATH, line);
  console.log(`[password reset ${entry.channel}] ${entry.to}: ${entry.code}`);
}

async function sendAdminResetEmail({ to, code, name }) {
  if (!process.env.SMTP_HOST) {
    await writeDevLog({ channel: 'email', to, code });
    return { delivered: false, fallback: 'log' };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    await writeDevLog({ channel: 'email', to, code });
    return { delivered: false, fallback: 'log', error: 'nodemailer is not installed' };
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    } : undefined
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'no-reply@iiserb.ac.in',
    to,
    subject: 'IISER Shift password reset code',
    text: `Hello ${name || 'Admin'},\n\nYour password reset code is ${code}. It expires in 10 minutes.\n\nIf you did not request this, ignore this email.`
  });

  return { delivered: true };
}

async function sendStaffOtp({ phone, code }) {
  if (!process.env.SMS_WEBHOOK_URL) {
    await writeDevLog({ channel: 'sms', to: phone, code });
    return { delivered: false, fallback: 'log' };
  }

  const res = await fetch(process.env.SMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: phone,
      message: `Your IISER Shift password reset OTP is ${code}. It expires in 10 minutes.`
    })
  });

  if (!res.ok) throw new Error('SMS provider rejected the OTP request');
  return { delivered: true };
}

module.exports = {
  LOG_PATH,
  sendAdminResetEmail,
  sendStaffOtp
};
