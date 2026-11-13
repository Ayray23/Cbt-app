import { createHash } from "node:crypto";
import { assert } from "./domain.mjs";
// Shared across API instances. Exam saves/submissions are deliberately excluded.
export async function limitMutation(db, uid, action, now = Date.now()) {
  if (
    [
      "exam.start",
      "exam.progress",
      "exam.submit",
      "account.verify",
      "lan.sync",
    ].includes(action)
  )
    return;
  const key = createHash("sha256").update(uid).digest("hex");
  const ref = db.doc(`requestLimits/${key}`);
  await db.runTransaction(async (tx) => {
    const row = await tx.get(ref);
    const previous = row.exists ? row.data() : {};
    const current =
      previous.until > now ? previous : { count: 0, until: now + 60000 };
    assert(
      current.count < 120,
      429,
      "Too many management requests. Wait one minute and retry.",
    );
    tx.set(ref, { count: current.count + 1, until: current.until });
  });
}
