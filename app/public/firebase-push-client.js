/* Firebase Web Messaging loader. Firebase config is supplied by the signed-in UI at runtime. */
(function () {
  let firebaseAppPromise;
  async function getFirebase(config) {
    if (!firebaseAppPromise) {
      firebaseAppPromise = Promise.all([
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging.js'),
      ]).then(([appSdk, messagingSdk]) => ({ appSdk, messagingSdk }));
    }
    const { appSdk, messagingSdk } = await firebaseAppPromise;
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(config);
    if (!(await messagingSdk.isSupported())) throw new Error('Este navegador no admite Firebase Messaging.');
    return { messaging: messagingSdk.getMessaging(app), messagingSdk };
  }
  window.RescatePush = {
    async enable(config, vapidKey) {
      if (!('serviceWorker' in navigator) || !('Notification' in window)) throw new Error('Este navegador no admite notificaciones push.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('No se concedió permiso para mostrar notificaciones.');
      const query = new URLSearchParams();
      Object.entries(config).forEach(([key, value]) => { if (value) query.set(key, value); });
      const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${query.toString()}`);
      const { messaging, messagingSdk } = await getFirebase(config);
      const token = await messagingSdk.getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
      if (!token) throw new Error('Firebase no generó un token para este dispositivo.');
      messagingSdk.onMessage(messaging, (payload) => window.dispatchEvent(new CustomEvent('rescate:push', { detail: { notification: payload.notification || { title: payload.data?.title, body: payload.data?.body }, data: payload.data } })));
      return token;
    },
    async disable(config, vapidKey) {
      const { messaging, messagingSdk } = await getFirebase(config);
      const token = await messagingSdk.getToken(messaging, { vapidKey });
      if (token) await messagingSdk.deleteToken(messaging);
      return token || null;
    },
  };
})();
