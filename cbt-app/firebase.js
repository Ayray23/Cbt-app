import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  initializeFirestore,
  connectFirestoreEmulator,
  memoryLocalCache,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const emulator = import.meta.env.VITE_USE_EMULATORS === "true";
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    (emulator ? "demo-cbt-school.firebaseapp.com" : undefined),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID || (emulator ? "demo-app" : undefined),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
if (
  !firebaseConfig.apiKey ||
  !firebaseConfig.projectId ||
  !firebaseConfig.authDomain ||
  !firebaseConfig.appId
) {
  document.body.textContent =
    "School configuration is missing. Ask the administrator to configure the Firebase environment for this deployment.";
  throw new Error(
    "Required VITE_FIREBASE_* configuration is missing; refusing to use a fallback project.",
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  // Keep admin answer keys and results out of shared devices' persistent Firestore cache.
  // Student exam packets are saved separately and never contain an answer key.
  localCache: memoryLocalCache(),
});
export const storage = getStorage(app);

if (import.meta.env.VITE_USE_EMULATORS === "true") {
  if (!firebaseConfig.projectId.startsWith("demo-"))
    throw new Error("Emulators require a demo project ID.");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
