import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
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
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
