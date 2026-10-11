export type PushClient = {
  enable: (config: Record<string, string>, vapidKey: string) => Promise<string>;
  disable: (config: Record<string, string>, vapidKey: string) => Promise<string | null>;
};

declare global {
  interface Window { RescatePush?: PushClient; }
}

let loader: Promise<PushClient> | undefined;
export function loadPushClient(): Promise<PushClient> {
  if (window.RescatePush) return Promise.resolve(window.RescatePush);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-rescate-push]');
      const script = existing ?? document.createElement('script');
      script.type = 'module';
      script.src = '/firebase-push-client.js';
      script.dataset.rescatePush = 'true';
      script.onload = () => window.RescatePush ? resolve(window.RescatePush) : reject(new Error('No se pudo iniciar el módulo de notificaciones.'));
      script.onerror = () => reject(new Error('No se pudo cargar Firebase Messaging. Revisa la conexión y el archivo firebase-push-client.js.'));
      if (!existing) document.head.appendChild(script);
    });
  }
  return loader;
}

export function getFirebaseWebConfig() {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY ?? '',
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
    projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
    appId: env.VITE_FIREBASE_APP_ID ?? '',
    measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? '',
  };
}

export function getFirebaseVapidKey() { return import.meta.env.VITE_FIREBASE_VAPID_KEY ?? ''; }
