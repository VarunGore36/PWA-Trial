let activeRole = 'admin';
let resetIdentifier = '';

function setTab(role) {
  activeRole = role;
  document.getElementById('tab-admin').classList.toggle('active', role === 'admin');
  document.getElementById('tab-staff').classList.toggle('active', role === 'staff');
  document.getElementById('login-id-label').textContent = role === 'admin' ? 'IISERB Email' : 'SSID';
  document.getElementById('login-id').placeholder = role === 'admin' ? 'admin@iiserb.ac.in' : 'Enter SSID';
  document.getElementById('login-id').value = '';
  document.getElementById('msg').innerHTML = '';
  if (document.getElementById('reset-panel').style.display === 'block') setupResetForm();
}

function showMsg(text, type = 'error') {
  document.getElementById('msg').innerHTML = `<div class="alert alert-${type}">${text}</div>`;
}

function showResetForm() {
  document.getElementById('login-panel').style.display = 'none';
  document.getElementById('reset-panel').style.display = 'block';
  document.getElementById('msg').innerHTML = '';
  setupResetForm();
}

function showLoginForm() {
  document.getElementById('reset-panel').style.display = 'none';
  document.getElementById('login-panel').style.display = 'block';
  document.getElementById('msg').innerHTML = '';
  resetIdentifier = '';
}

function setupResetForm() {
  resetIdentifier = '';
  const isAdmin = activeRole === 'admin';
  document.getElementById('reset-title').textContent = isAdmin ? 'Admin Password Reset' : 'Staff Password Reset';
  document.getElementById('reset-copy').textContent = isAdmin
    ? 'Enter your registered IISERB email address. A reset code will be sent to that email.'
    : 'Enter your registered phone number. An OTP will be sent to that number.';
  document.getElementById('reset-email-group').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('reset-phone-group').style.display = isAdmin ? 'none' : 'block';
  document.getElementById('request-reset-btn').textContent = isAdmin ? 'Send Reset Code' : 'Send OTP';
  document.getElementById('request-reset-btn').style.display = 'inline-flex';
  document.getElementById('request-reset-btn').style.justifyContent = 'center';
  document.querySelectorAll('.reset-code-step').forEach(el => {
    el.style.display = 'none';
  });
  ['reset-email', 'reset-phone', 'reset-otp', 'reset-password'].forEach(id => {
    document.getElementById(id).value = '';
  });
}

function showResetCodeStep(identifier) {
  resetIdentifier = identifier;
  document.getElementById('request-reset-btn').style.display = 'none';
  document.querySelectorAll('.reset-code-step').forEach(el => {
    el.style.display = el.tagName === 'BUTTON' ? 'inline-flex' : 'block';
  });
  document.getElementById('complete-reset-btn').style.justifyContent = 'center';
}

async function doLogin() {
  const loginId = document.getElementById('login-id').value.trim();
  const password = document.getElementById('password').value;

  if (!loginId || !password) {
    showMsg(activeRole === 'admin' ? 'Please enter IISERB email and password.' : 'Please enter SSID and password.');
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: activeRole,
        email: activeRole === 'admin' ? loginId : undefined,
        ssid: activeRole === 'staff' ? loginId : undefined,
        password
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Login failed.');
      return;
    }

    window.location.href = data.role === 'admin' ? '/admin' : '/staff';
  } catch (e) {
    showMsg('Network error. Please try again.');
  }
}

async function resetPassword() {
  const email = document.getElementById('reset-email').value.trim();
  const phone = document.getElementById('reset-phone').value.trim();
  const otp = document.getElementById('reset-otp').value.trim();
  const password = document.getElementById('reset-password').value;

  if (!otp || !password) {
    showMsg('Please enter the OTP and a new password.');
    return;
  }

  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: activeRole,
        email: activeRole === 'admin' ? (resetIdentifier || email) : undefined,
        phone: activeRole === 'staff' ? (resetIdentifier || phone) : undefined,
        otp,
        password
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Password reset failed.');
      return;
    }

    showLoginForm();
    showMsg('Password reset successfully. Please sign in.', 'success');
  } catch (e) {
    showMsg('Network error. Please try again.');
  }
}

async function requestPasswordReset() {
  const email = document.getElementById('reset-email').value.trim();
  const phone = document.getElementById('reset-phone').value.trim();
  const identifier = activeRole === 'admin' ? email : phone;

  if (!identifier) {
    showMsg(activeRole === 'admin' ? 'Please enter your registered email address.' : 'Please enter your registered phone number.');
    return;
  }

  try {
    const res = await fetch('/api/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: activeRole,
        email: activeRole === 'admin' ? email : undefined,
        phone: activeRole === 'staff' ? phone : undefined
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || 'Could not send OTP.');
      return;
    }

    showResetCodeStep(identifier);
    showMsg(data.message || 'OTP sent.', 'success');
  } catch (e) {
    showMsg('Network error. Please try again.');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-panel').style.display !== 'none') doLogin();
});

(async () => {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      window.location.href = data.role === 'admin' ? '/admin' : '/staff';
    }
  } catch {}
})();
