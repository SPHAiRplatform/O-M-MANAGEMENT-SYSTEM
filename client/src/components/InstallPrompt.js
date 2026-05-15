import React, { useState, useEffect } from 'react';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already installed (running in standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return;
    if (sessionStorage.getItem('pwa-prompt-dismissed')) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    setIsIOS(ios);

    if (ios) {
      // iOS doesn't fire beforeinstallprompt — show manual guide after a delay
      const t = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(t);
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShow(false);
    setDismissed(true);
    sessionStorage.setItem('pwa-prompt-dismissed', '1');
  };

  if (!show || dismissed) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <img src="/logo192.png" alt="SPHAiRDigital" style={styles.logo} />
        <div style={styles.text}>
          <strong style={styles.title}>Install SPHAiR O&amp;M</strong>
          {isIOS ? (
            <p style={styles.desc}>
              Tap <b>Share</b> <span style={styles.icon}>⎋</span> then <b>"Add to Home Screen"</b> to install this app on your device.
            </p>
          ) : (
            <p style={styles.desc}>Install this app on your device for quick access — no browser needed.</p>
          )}
        </div>
        <div style={styles.actions}>
          <button style={styles.dismiss} onClick={handleDismiss}>Not now</button>
          {!isIOS && (
            <button style={styles.install} onClick={handleInstall}>Install</button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    bottom: 24,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 9999,
    width: 'min(420px, calc(100vw - 32px))',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    border: '1px solid #e8eaf6',
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 10,
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    display: 'block',
    fontSize: 14,
    color: '#1a1a2e',
    marginBottom: 2,
  },
  desc: {
    fontSize: 12,
    color: '#555',
    margin: 0,
    lineHeight: 1.5,
  },
  icon: {
    fontSize: 14,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  install: {
    background: '#1A73E8',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  dismiss: {
    background: 'transparent',
    color: '#888',
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '6px 16px',
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
};
