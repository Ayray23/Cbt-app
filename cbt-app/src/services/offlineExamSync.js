import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "/firebase";
import { getLocalExamDraft } from "./sessionService";

export async function syncLocalExamDraft(examId) {
  const currentUser = auth.currentUser;
  if (!currentUser || !window.navigator.onLine) return { synced: false };

  const draft = getLocalExamDraft(currentUser.uid, examId);
  if (!draft) return { synced: false };

  const sessionRef = doc(db, "examSessions", `${examId}_${currentUser.uid}`);
  try {
    const sessionSnapshot = await getDoc(sessionRef);
    if (!sessionSnapshot.exists()) return { synced: false };
    const session = sessionSnapshot.data();
    if (session.status === "submitted") return { synced: false, alreadySubmitted: true };

    await updateDoc(sessionRef, {
      answers: draft.answers || {},
      ...(draft.tabSwitchCount !== undefined ? { tabSwitchCount: Number(draft.tabSwitchCount || 0) } : {}),
      ...(draft.integrityWarnings !== undefined ? { integrityWarnings: Number(draft.integrityWarnings || 0) } : {}),
      lastSavedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { synced: true };
  } catch (error) {
    console.error("Offline exam draft sync failed", error);
    return { synced: false, error };
  }
}
