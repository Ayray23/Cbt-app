import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  memoryLocalCache,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ??
    "AIzaSyAGAaFwZFHg_Ezm-JSLIstV44eNkG55FJ4",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    "cbt-app-63991.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "cbt-app-63991",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ??
    "cbt-app-63991.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "1060678784298",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ??
    "1:1060678784298:web:182d21db688b75531b3a53",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // Keep admin answer keys and results out of shared devices' persistent Firestore cache.
  // Student exam packets are saved separately and never contain an answer key.
  localCache: memoryLocalCache(),
});
export const storage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  if (!firebaseConfig.projectId.startsWith('demo-')) throw new Error('Emulators require a demo project ID.');
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
