// Emergency exam-day fallback: export the submitted answer packet from this
// device, never the paper, hidden marking key, or personal PIN.
// This file is evidence for an invigilator, NOT a trusted scored result.
export function makeOfflineSubmissionReceipt(packet, uid) {
  if (!packet?.closed || !packet.pending || !packet.session?.examId) {
    throw new Error("Only a closed exam with an unsynced submission can be exported.");
  }
  if (packet.session.studentUid !== uid) {
    throw new Error("This saved submission belongs to a different student.");
  }
  const saved = packet.pending;
  const answers = saved.answers || packet.answers || {};
  const receipt = {
    format: "cbt-offline-submission-v1",
    exportedAt: new Date().toISOString(),
    studentUid: uid,
    examId: packet.session.examId,
    examTitle: packet.session.examTitle || packet.session.examId,
    submissionId: saved.submissionId,
    closedAtMs: saved.closedAtMs || packet.closedAtMs,
    submissionReason: saved.submissionReason || "timeout",
    answerCount: Object.keys(answers).length,
    // Matches the existing Monitoring > Recover device answers file reader.
    packets: [{
      session: {
        examId: packet.session.examId,
        studentUid: uid,
        examTitle: packet.session.examTitle || packet.session.examId,
        expiresAtMs: packet.session.expiresAtMs,
        paperVersion: packet.session.paperVersion,
      },
      closed: true,
      closedAtMs: saved.closedAtMs || packet.closedAtMs,
      answers,
      pending: {
        examId: packet.session.examId,
        answers,
        submissionId: saved.submissionId,
        closedAtMs: saved.closedAtMs || packet.closedAtMs,
        submissionReason: saved.submissionReason || "timeout",
      },
    }],
  };
  return receipt;
}

export function offlineReceiptFilename(receipt) {
  const clean = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
  return `cbt-offline-${clean(receipt.examId)}-${clean(receipt.studentUid)}-${clean(receipt.submissionId || receipt.closedAtMs)}.json`;
}
