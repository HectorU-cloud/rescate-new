/* Firebase background notifications. Firebase public web config is passed in the registration URL. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
const params = new URL(self.location.href).searchParams;
const firebaseConfig = Object.fromEntries(
  ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId']
    .map((key) => [key, params.get(key)])
    .filter(([, value]) => Boolean(value)),
);
if (firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage((payload) => {
    const title = payload.data?.title || payload.notification?.title || 'Rescate';
    const options = {
      body: payload.data?.body || payload.notification?.body || 'Tienes una actualización de tu pedido.',
      icon: '/favicon.ico',
      data: { url: payload.data?.url || '/pedidos' },
      tag: payload.data?.orderId ? `rescate-order-${payload.data.orderId}` : 'rescate-notification',
    };
    self.registration.showNotification(title, options);
  });
}
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/pedidos', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) { client.navigate(target); return client.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});
