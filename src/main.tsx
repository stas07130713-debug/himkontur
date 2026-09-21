import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import { App } from './ui/App';
import './ui/styles.css';

// Capacitor packages every asset inside the application. Registering a web
// service worker there is unnecessary and can leave an old HTML shell paired
// with new hashed JavaScript files after an APK update. That combination looks
// like an endless loading screen. The service worker remains enabled for the
// browser/PWA build only.
const isPackagedDesktop = window.navigator.userAgent.includes('Electron');
if (!Capacitor.isNativePlatform() && !isPackagedDesktop) {
  registerSW({ immediate: true });
}

const root = document.getElementById('root');
if (root === null) throw new Error('Корневой элемент интерфейса не найден.');
createRoot(root).render(<StrictMode><App /></StrictMode>);
window.requestAnimationFrame(() => {
  window.dispatchEvent(new Event('himkontur-ready'));
});
