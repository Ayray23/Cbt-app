import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export function backend() {
  let app = getApps().find((item) => item.name === "cbt-api");
  if (!app) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error("Set FIREBASE_SERVICE_ACCOUNT_JSON on the server before using the CBT API.");
    const account = JSON.parse(raw);
    app = initializeApp({ credential: cert(account), projectId: account.project_id }, "cbt-api");
  }
  return { db: getFirestore(app), auth: getAuth(app), fields: FieldValue };
}
