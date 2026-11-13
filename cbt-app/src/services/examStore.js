import { offlineStore, examRecordKey } from "./offlineStore.js";
const PREFIX = "cbt_exam_v2:";

// Separate user/exam keys prevent one sync from overwriting another queued paper.
export function createExamStore(storage, notify = () => {}) {
  const key = (uid, examId) => `${PREFIX}${uid}:${examId}`;
  function read(uid, examId) {
    const raw = storage.getItem(key(uid, examId));
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(
        "Damaged saved exam packet. Use recovery or contact your supervisor; do not clear browser data.",
      );
    }
  }
  function write(uid, examId, value) {
    storage.setItem(key(uid, examId), JSON.stringify(value));
    notify(uid, examId, value);
    return value;
  }
  function list(uid) {
    return Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    )
      .filter((item) => item?.startsWith(`${PREFIX}${uid}:`))
      .flatMap((item) => {
        try {
          return [JSON.parse(storage.getItem(item))];
        } catch {
          return [];
        }
      });
  }
  return {
    read,
    list,
    restore(uid, examId, value) {
      return write(uid, examId, value);
    },
    deadline(uid, examId, expiresAtMs) {
      const current = read(uid, examId);
      if (current && !current.closed)
        return write(uid, examId, {
          ...current,
          session: { ...current.session, expiresAtMs },
        });
    },
    putPacket(uid, examId, packet) {
      const current = read(uid, examId);
      if (current?.closed) return current;
      const sameEpoch =
        (current?.session?.deviceEpoch || 0) ===
        (packet.session.deviceEpoch || 0);
      const answers =
        current?.dirty && sameEpoch ? current.answers : packet.session.answers;
      return write(uid, examId, {
        ...current,
        ...packet,
        answers: answers || {},
        revision: Math.max(
          sameEpoch ? current?.revision || 0 : 0,
          packet.session.progressRevision || 0,
        ),
        dirty: sameEpoch && Boolean(current?.dirty),
      });
    },
    save(uid, examId, answers, metadata = {}) {
      const current = read(uid, examId);
      if (!current || current.closed) return current;
      return write(uid, examId, {
        ...current,
        answers,
        metadata,
        revision: (current.revision || 0) + 1,
        dirty: true,
        savedAtMs: Date.now(),
      });
    },
    close(uid, examId, payload) {
      const current = read(uid, examId);
      if (!current)
        throw new Error(
          "This exam is not saved on this device. Contact your supervisor.",
        );
      if (current.closed) return current;
      return write(uid, examId, {
        ...current,
        answers: payload.answers,
        closed: true,
        pending: payload,
        closedAtMs: payload.closedAtMs,
        syncError: "",
      });
    },
    acknowledge(uid, examId, submissionId) {
      const current = read(uid, examId);
      if (current?.pending?.submissionId !== submissionId) return;
      return write(uid, examId, {
        session: { ...current.session, status: "submitted" },
        closed: true,
        closedAtMs: current.closedAtMs,
        pending: null,
        syncError: "",
      });
    },
    syncError(uid, examId, message) {
      const current = read(uid, examId);
      if (current?.pending)
        write(uid, examId, { ...current, syncError: message });
    },
  };
}

export function deviceExamStore() {
  return createExamStore(window.localStorage, (uid, examId, value) => {
    void offlineStore
      .put(examRecordKey(uid, examId), value)
      .catch(() => window.dispatchEvent(new Event("cbt:durability-error")));
    window.dispatchEvent(new Event("cbt:exam-storage"));
  });
}
