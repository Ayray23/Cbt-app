const PREFIX = "cbt_exam_v2:";

// Separate user/exam keys prevent one sync from overwriting another queued paper.
export function createExamStore(storage, notify = () => {}) {
  const key = (uid, examId) => `${PREFIX}${uid}:${examId}`;
  function read(uid, examId) {
    const raw = storage.getItem(key(uid, examId));
    return raw ? JSON.parse(raw) : null;
  }
  function write(uid, examId, value) {
    storage.setItem(key(uid, examId), JSON.stringify(value));
    notify();
    return value;
  }
  function list(uid) {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((item) => item?.startsWith(`${PREFIX}${uid}:`))
      .map((item) => JSON.parse(storage.getItem(item)));
  }
  return {
    read, list,
    putPacket(uid, examId, packet) {
      const current = read(uid, examId);
      if (current?.closed) return current;
      const answers = current?.dirty ? current.answers : packet.session.answers;
      return write(uid, examId, { ...current, ...packet, answers: answers || {}, dirty: Boolean(current?.dirty) });
    },
    save(uid, examId, answers, metadata = {}) {
      const current = read(uid, examId);
      if (!current || current.closed) return current;
      return write(uid, examId, { ...current, answers, metadata, dirty: true, savedAtMs: Date.now() });
    },
    close(uid, examId, payload) {
      const current = read(uid, examId);
      if (!current) throw new Error("This exam is not saved on this device. Contact your supervisor.");
      if (current.closed) return current;
      return write(uid, examId, { ...current, answers: payload.answers, closed: true, pending: payload,
        closedAtMs: payload.closedAtMs, syncError: "" });
    },
    acknowledge(uid, examId, submissionId) {
      const current = read(uid, examId);
      if (current?.pending?.submissionId !== submissionId) return;
      return write(uid, examId, { session: { ...current.session, status: "submitted" }, closed: true,
        closedAtMs: current.closedAtMs, pending: null, syncError: "" });
    },
    syncError(uid, examId, message) {
      const current = read(uid, examId);
      if (current?.pending) write(uid, examId, { ...current, syncError: message });
    },
  };
}

export function deviceExamStore() {
  return createExamStore(window.localStorage, () => window.dispatchEvent(new Event("cbt:exam-storage")));
}
