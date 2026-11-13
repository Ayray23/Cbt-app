export function fakeBackend(initial = {}) {
  const records = new Map(Object.entries(initial).map(([path, data]) => [path, structuredClone(data)]));
  let sequence = 0;
  const snapshot = (ref) => ({ ref, id: ref.id, exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  function reference(path) {
    return { path, id: path.split("/").at(-1), get: async () => snapshot(reference(path)),
      create: async (data) => { if (records.has(path)) throw new Error("Already exists"); records.set(path, structuredClone(data)); },
      update: async (data) => { records.set(path, { ...records.get(path), ...structuredClone(data) }); } };
  }
  function collection(path, filters = [], max = Infinity) {
    return { path, filters, max, where(field, op, value) { return collection(path, [...filters, [field, op, value]], max); },
      limit(limit) { return collection(path, filters, limit); }, doc(id) { return reference(`${path}/${id || `generated-${++sequence}`}`); },
      async get() {
        const docs = [...records.keys()].filter((key) => key.startsWith(`${path}/`) && key.split("/").length === path.split("/").length + 1)
          .filter((key) => filters.every(([field, , value]) => records.get(key)[field] === value)).slice(0, max).map((key) => snapshot(reference(key)));
        return { docs, empty: docs.length === 0 };
      } };
  }
  let transactionTail = Promise.resolve();
  const db = {
    doc: reference, collection, getAll: async (...refs) => refs.map(snapshot),
    runTransaction(action) {
      const run = transactionTail.then(async () => {
        const writes = [];
        let writing = false;
        const tx = { get: async (ref) => {
          if (writing) throw new Error("Reads must precede writes");
          return ref.filters ? ref.get() : snapshot(ref);
        }, create(ref, data) { writing = true; writes.push(() => {
          if (records.has(ref.path)) throw new Error("Already exists"); records.set(ref.path, structuredClone(data));
        }); }, set(ref, data) { writing = true; writes.push(() => records.set(ref.path, structuredClone(data))); },
        update(ref, data) { writing = true; writes.push(() => records.set(ref.path, { ...records.get(ref.path), ...structuredClone(data) })); },
        delete(ref) { writing = true; writes.push(() => records.delete(ref.path)); } };
        const result = await action(tx);
        writes.forEach((write) => write());
        return result;
      });
      transactionTail = run.catch(() => {});
      return run;
    },
  };
  const auth = { verifyIdToken: async (token) => {
    if (token === "invalid") throw new Error("Invalid token"); return { uid: token };
  }, createUser: async (profile) => ({ uid: `user-${++sequence}`, ...profile }), deleteUser: async () => {} };
  return { db, auth, fields: { serverTimestamp: () => ({ seconds: 1700000000 }), delete: () => null }, records };
}

export function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index],
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
