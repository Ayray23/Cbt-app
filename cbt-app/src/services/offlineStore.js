// Durable browser-side storage. No question answer keys should be stored here.
const DB_NAME = "cbt-offline-v1";
const STORE = "records";
function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
async function transaction(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export const offlineStore = {
  get: (key) => transaction("readonly", (store) => store.get(key)),
  put: (key, value) => transaction("readwrite", (store) => store.put(value, key)),
  delete: (key) => transaction("readwrite", (store) => store.delete(key)),
  keys: () => transaction("readonly", (store) => store.getAllKeys()),
};
export function examRecordKey(uid, examId) { return `exam:${uid}:${examId}`; }
export function submissionRecordKey(uid, examId) { return `submission:${uid}:${examId}`; }
