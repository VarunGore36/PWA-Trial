function confirmLogout() {
  return new Promise(resolve => {
    let overlay = document.getElementById('logout-confirm-modal');

    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.id = 'logout-confirm-modal';
      overlay.innerHTML = `
        <div class="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="logout-confirm-title">
          <div class="modal-header" id="logout-confirm-title">Confirm Logout</div>
          <p class="modal-text">Are you sure you want to log out?</p>
          <div class="modal-footer">
            <button class="btn btn-outline" type="button" data-logout-cancel>Cancel</button>
            <button class="btn btn-danger" type="button" data-logout-confirm>Logout</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    const close = value => {
      overlay.classList.remove('open');
      resolve(value);
    };

    overlay.querySelector('[data-logout-cancel]').onclick = () => close(false);
    overlay.querySelector('[data-logout-confirm]').onclick = () => close(true);
    overlay.onclick = event => {
      if (event.target === overlay) close(false);
    };

    overlay.classList.add('open');
    overlay.querySelector('[data-logout-cancel]').focus();
  });
}
