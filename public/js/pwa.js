(function () {
  const installButton = document.createElement('button');
  let deferredInstallPrompt = null;

  installButton.type = 'button';
  installButton.className = 'pwa-install-btn';
  installButton.textContent = 'Install App';
  installButton.hidden = true;
  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  function showConnectionState() {
    let banner = document.querySelector('.pwa-status');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'pwa-status';
      document.body.appendChild(banner);
    }

    banner.textContent = navigator.onLine ? 'Back online' : 'Offline mode';
    banner.classList.toggle('is-offline', !navigator.onLine);
    banner.classList.add('is-visible');

    window.clearTimeout(showConnectionState.timer);
    showConnectionState.timer = window.setTimeout(() => {
      if (navigator.onLine) banner.classList.remove('is-visible');
    }, 2400);
  }

  function wireServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then(registration => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateReady(worker);
          }
        });
      });
    });
  }

  function showUpdateReady(worker) {
    const updateBar = document.createElement('div');
    updateBar.className = 'pwa-update';
    updateBar.innerHTML = '<span>Update ready</span><button type="button">Refresh</button>';
    updateBar.querySelector('button').addEventListener('click', () => {
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
    document.body.appendChild(updateBar);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(installButton);
    if (!navigator.onLine) showConnectionState();
    wireServiceWorker();
  });

  window.addEventListener('online', showConnectionState);
  window.addEventListener('offline', showConnectionState);
})();
