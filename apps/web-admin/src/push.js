import { apiFetch } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker.register('/sw.js');
}

export async function getPushSubscriptionStatus() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration) return 'unsupported';
  const sub = await registration.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePushNotifications() {
  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    console.warn('VITE_VAPID_PUBLIC_KEY not set — push notifications are not configured yet.');
    return { ok: false, reason: 'not_configured' };
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  const res = await apiFetch('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  });
  if (!res.ok) return { ok: false, reason: 'server_error' };

  return { ok: true };
}
