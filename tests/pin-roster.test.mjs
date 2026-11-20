import test from "node:test";
import assert from "node:assert/strict";
import {
  PIN_ROSTER_TTL_MS,
  clearPinRosterCaches,
  latestPinRosterExamId,
  mergePinRoster,
  readPinRosters,
  writePinRosters,
} from "../cbt-app/src/services/pinRosterStore.js";

function storage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(key) { return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

const student = (studentUid, pin) => ({
  studentUid,
  pin,
  name: studentUid,
  username: studentUid,
});

test("restores multiple recent exam rosters for the same authorized staff session", () => {
  const store = storage();
  let rosters = {};
  rosters = mergePinRoster(rosters, "math", {
    examTitle: "Mathematics",
    pins: [student("alice", "123456"), student("bob", "222222")],
  }, 10000);
  rosters = mergePinRoster(rosters, "english", {
    examTitle: "English",
    pins: [student("alice", "654321")],
  }, 20000);
  assert.equal(writePinRosters("owner", rosters, store), true);
  const restored = readPinRosters("owner", store, 20001);
  assert.equal(restored.math.pins.length, 2);
  assert.equal(restored.english.pins[0].pin, "654321");
  assert.equal(latestPinRosterExamId(restored), "english");
  assert.deepEqual(readPinRosters("different-staff", store, 20001), {});
});

test("combines 100-student batches without dropping earlier PINs or retaining rotated PINs", () => {
  const first = Array.from({length: 100}, (_,i) => student(`candidate${i}`, String(i).padStart(6,"0")));
  let rosters = mergePinRoster({}, "math", {examTitle:"Mathematics", pins:first}, 1000);
  rosters = mergePinRoster(rosters, "math", {examTitle:"Mathematics", pins:[student("candidate1","999999"),student("candidate100","777777")]}, 2000);
  assert.equal(rosters.math.pins.length, 101);
  assert.equal(rosters.math.pins.find(x=>x.studentUid==="candidate1").pin, "999999");
  assert.equal(rosters.math.pins.find(x=>x.studentUid==="candidate0").pin, "000000");
});

test("PIN rosters expire after eight hours and all staff copies are cleared at logout", () => {
  const store = storage();
  const rosters = mergePinRoster({}, "math", {examTitle:"Math", pins:[student("a","444444")]}, 1000);
  assert(writePinRosters("owner", rosters, store));
  assert.equal(readPinRosters("owner", store, 1000 + PIN_ROSTER_TTL_MS - 1).math.pins.length, 1);
  assert.deepEqual(readPinRosters("owner", store, 1000 + PIN_ROSTER_TTL_MS), {});
  writePinRosters("owner", rosters, store);
  writePinRosters("another", rosters, store);
  store.setItem("unrelated", "keep");
  clearPinRosterCaches(store);
  assert.deepEqual(readPinRosters("owner", store, 1001), {});
  assert.deepEqual(readPinRosters("another", store, 1001), {});
  assert.equal(store.getItem("unrelated"), "keep");
});

test("if sessionStorage is blocked the UI can still print or export the generated list", () => {
  const blocked = {
    getItem() {throw Error("blocked");},
    setItem() {throw Error("blocked");},
    removeItem() {throw Error("blocked");},
  };
  const generated = mergePinRoster({}, "math", {examTitle:"Math",pins:[student("a","123456")]}, 1000);
  assert.equal(writePinRosters("owner", generated, blocked), false);
  assert.deepEqual(readPinRosters("owner", blocked, 1001), {});
  assert.equal(generated.math.pins[0].pin, "123456");
});
