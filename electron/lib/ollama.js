const http = require('node:http');
const { Notification } = require('electron');

const OLLAMA_URL = 'http://localhost:11434/';
const CHECK_INTERVAL_MS = 15000;
const PROBE_TIMEOUT_MS = 2500;
const BANNER_TEXT = 'Ollama is not running. Start Ollama to chat with Finch.';

function probeOllama() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (up) => {
      if (settled) return;
      settled = true;
      resolve(up);
    };
    const request = http.get(OLLAMA_URL, { timeout: PROBE_TIMEOUT_MS }, (response) => {
      // Any HTTP answer means something is listening on the Ollama port.
      response.resume();
      finish(true);
    });
    request.on('error', () => finish(false));
    request.on('timeout', () => {
      request.destroy();
      finish(false);
    });
  });
}

// The banner lives outside React's #root, so re-renders do not remove it.
function bannerScript(show) {
  return `(() => {
    const id = 'finch-ollama-banner';
    const existing = document.getElementById(id);
    if (!${show ? 'true' : 'false'}) {
      if (existing) existing.remove();
      return true;
    }
    if (!document.body) return false;
    const banner = existing || document.createElement('div');
    banner.id = id;
    banner.textContent = ${JSON.stringify(BANNER_TEXT)};
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    Object.assign(banner.style, {
      position: 'fixed',
      top: '14px',
      right: '14px',
      zIndex: '2147483647',
      maxWidth: '320px',
      padding: '10px 14px',
      borderRadius: '10px',
      background: 'rgba(15, 18, 24, 0.94)',
      color: '#f2f5f9',
      font: '500 13px/1.45 system-ui, -apple-system, Segoe UI, sans-serif',
      boxShadow: '0 10px 28px rgba(0, 0, 0, 0.4)',
      border: '1px solid rgba(255, 255, 255, 0.14)'
    });
    if (!existing) document.body.appendChild(banner);
    return true;
  })()`;
}

// Detect-only: Ollama down never blocks or crashes Finch, it only shows a
// non-blocking banner in the window (desktop notification when the banner
// cannot be injected).
function createOllamaMonitor(getWindow) {
  let timer = null;
  let probing = false;
  let ollamaUp = null;

  async function applyBanner(show) {
    const appWindow = getWindow();
    const contents = appWindow && !appWindow.isDestroyed() ? appWindow.webContents : null;
    if (!contents || contents.isDestroyed()) return false;
    try {
      await contents.executeJavaScript(bannerScript(show), true);
      return true;
    } catch {
      return false;
    }
  }

  function notifyDesktop() {
    try {
      if (Notification.isSupported()) {
        new Notification({ title: 'Finch', body: BANNER_TEXT }).show();
      }
    } catch {}
  }

  async function tick() {
    if (probing) return;
    probing = true;
    try {
      const up = await probeOllama();
      const changed = ollamaUp !== up;
      ollamaUp = up;
      if (!up) {
        const bannerVisible = await applyBanner(true);
        if (changed && !bannerVisible) notifyDesktop();
      } else if (changed) {
        await applyBanner(false);
      }
    } finally {
      probing = false;
    }
  }

  return {
    start() {
      tick();
      if (!timer) timer = setInterval(tick, CHECK_INTERVAL_MS);
    },
    // Called after a page load so a reload does not lose the banner.
    refresh() {
      if (ollamaUp === false) applyBanner(true);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

module.exports = { createOllamaMonitor };
