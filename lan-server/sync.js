// LAN -> trusted cloud reconciliation. Safe to call after a process restart:
// the SQLite ledger is authoritative and only acknowledged records are marked
// synced. A disconnected network never clears queued submissions.
export function validateCloudUrl(address) {
  const url = new URL(address);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) ||
    url.username || url.password || url.search || url.hash
  ) throw new Error("Cloud synchronization requires a clean HTTPS API endpoint.");
  return url.href;
}

export async function syncPending(store, address, { request = fetch, timeoutMs = 30000 } = {}) {
  const url = validateCloudUrl(address);
  let synchronized = 0;
  for (const bundle of store.batches()) {
    for (let i = 0; i < bundle.records.length; i += 10) {
      const records = bundle.records.slice(i, i + 10);
      const requested = new Set(records.map((r) => `${bundle.examId}_${r.uid}`));
      const response = await request(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bundle.secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "lan.sync",
          grantId: bundle.grantId,
          records,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        let reason = "Cloud sync refused the batch";
        try {
          const detail = await response.json();
          reason = detail.error || reason;
        } catch { /* Retain the queued submissions. */ }
        throw new Error(reason);
      }
      const reply = await response.json();
      if (!Array.isArray(reply.accepted) ||
          new Set(reply.accepted).size !== reply.accepted.length ||
          reply.accepted.some((id) => !requested.has(id)))
        throw new Error("Invalid cloud acknowledgement; submissions remain queued.");
      if (reply.accepted.length) {
        store.acknowledge(reply.accepted);
        synchronized += reply.accepted.length;
      }
      if (reply.accepted.length !== requested.size)
        throw new Error("Cloud did not acknowledge the full batch; unacknowledged results remain queued.");
    }
  }
  return synchronized;
}
