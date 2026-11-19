import { useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "/firebase";
import { useAuth } from "../contexts/AuthContext";
import { deviceExamStore } from "../services/examStore";
import { recoverDevicePackets } from "../services/sessionService";
import { offlineStore, examRecordKey } from "../services/offlineStore";
export default function OfflineRecovery() {
  const { user } = useAuth();
  const [message, setMessage] = useState("");
  async function exportCopy() {
    try {
      await recoverDevicePackets(user.uid);
      const packets = deviceExamStore().list(user.uid);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify({ version: 1, uid: user.uid, packets })], {
          type: "application/json",
        }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "cbt-device-recovery.json";
      a.click();
      URL.revokeObjectURL(url);
      setMessage(
        "Recovery copy downloaded. Give it only to your school supervisor.",
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  async function cleanup() {
    try {
      let removed = 0;
      for (const packet of deviceExamStore().list(user.uid)) {
        if (packet.pending) continue;
        const id = packet.session.examId;
        const result = await getDoc(
          doc(db, "examSessions", `${id}_${user.uid}`),
        );
        if (result.exists() && result.data().status === "submitted") {
          await offlineStore.delete(examRecordKey(user.uid, id));
          localStorage.removeItem(`cbt_exam_v2:${user.uid}:${id}`);
          removed++;
        }
      }
      setMessage(
        `Removed ${removed} server-confirmed submitted packet(s). Pending answers were retained.`,
      );
    } catch (e) {
      setMessage(e.message);
    }
  }
  return (
    <section className="bg-white p-6 rounded-2xl space-y-4">
      <h2 className="text-2xl font-semibold">Device recovery</h2>
      <p>
        Export your saved answers before a computer transfer. Only the
        supervisor can import them into an active attempt. Never clear browser
        data while submissions are pending.
      </p>
      <button className="border p-3" onClick={exportCopy}>
        Export recovery copy
      </button>
      <button
        className="border p-3"
        onClick={async () => {
          try {
            await recoverDevicePackets(user.uid);
            setMessage(
              "IndexedDB recovery checked. Return to Exams to continue.",
            );
          } catch (e) {
            setMessage(e.message);
          }
        }}
      >
        Restore browser backup
      </button>
      <button className="border p-3" onClick={cleanup}>
        Clean confirmed submissions
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
