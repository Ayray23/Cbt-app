const $ = (id) => document.getElementById(id);
const device = localStorage.getItem("lan-device") || crypto.randomUUID();
localStorage.setItem("lan-device", device);
$("device").textContent = `Computer ID: ${device}`;
let packet,
  ticket,
  index = 0,
  busy = false,
  writeChain = Promise.resolve(),
  release;
const status = (text) => {
  $("status").textContent = text;
};
async function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("school-lan-exams", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("packets");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function storage(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("packets", mode);
      const req = action(tx.objectStore("packets"));
      let value;
      req.onsuccess = () => {
        value = req.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error || new Error("Storage transaction aborted"));
    });
  } finally {
    db.close();
  }
}
function persist() {
  const value = structuredClone(packet);
  const key = ticket;
  const job = writeChain.then(() =>
    storage("readwrite", (s) => s.put(value, key)),
  );
  writeChain = job.catch(() => {});
  return job;
}
async function api(path, input) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ticket}`,
      },
      body: JSON.stringify({ ...input, deviceId: device }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    e.network = true;
    throw e;
  }
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.error);
    error.status = response.status;
    throw error;
  }
  return result;
}
async function reserve() {
  if (!navigator.locks)
    throw new Error("Use a current browser over trusted HTTPS.");
  return new Promise((resolve, reject) => {
    navigator.locks
      .request(`lan-exam-${ticket}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error("This exam is already open in another tab."));
          return;
        }
        resolve();
        await new Promise((r) => {
          release = r;
        });
      })
      .catch(reject);
  });
}
async function start() {
  if (busy) return;
  busy = true;
  ticket = $("ticket").value.trim();
  try {
    if (!ticket) throw new Error("Enter your personal ticket.");
    await reserve();
    const cached = await storage("readonly", (s) => s.get(ticket));
    try {
      const remote = await api("/api/login", { ticket });
      packet = cached?.closed
        ? cached
        : {
            ...remote,
            answers:
              cached?.dirty &&
              (cached.session.deviceEpoch || 0) ===
                (remote.session.deviceEpoch || 0)
                ? cached.answers
                : remote.session.answers || {},
            revision: Math.max(
              (cached?.session?.deviceEpoch || 0) ===
                (remote.session.deviceEpoch || 0)
                ? cached?.revision || 0
                : 0,
              remote.session.revision || 0,
            ),
            offsetMs: remote.serverNowMs - Date.now(),
            dirty: Boolean(cached?.dirty),
          };
      if (remote.session.status === "submitted") {
        packet.closed = true;
        packet.acknowledged = true;
      }
    } catch (e) {
      if (!cached || !e.network) throw e;
      packet = cached;
    }
    await persist();
    localStorage.setItem("lan-active-ticket", ticket);
    $("login").hidden = true;
    $("exam").hidden = false;
    render();
    await sync();
  } catch (e) {
    release?.();
    release = null;
    status(e.message);
  } finally {
    busy = false;
  }
}
function render() {
  if (!packet) return;
  $("title").textContent = packet.session.examTitle;
  const questions = packet.session.questionOrder.map((id) =>
    packet.questions.find((q) => q.id === id),
  );
  const q = questions[index];
  $("progress").textContent =
    `${Object.keys(packet.answers || {}).length} of ${questions.length} answered`;
  $("palette").replaceChildren();
  questions.forEach((q, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1}${packet.answers?.[q.id] ? " ✓" : ""}`;
    b.onclick = () => {
      index = i;
      render();
    };
    $("palette").append(b);
  });
  $("question").textContent = q.text;
  $("diagram").hidden = !q.image;
  if (q.image) {
    $("diagram").src = q.image;
    $("diagram").alt = q.imageAlt || "Question diagram";
  }
  $("options").replaceChildren();
  (packet.session.optionOrderByQuestion[q.id] || ["A", "B", "C", "D"]).forEach(
    (key, i) => {
      const label = document.createElement("label"),
        radio = document.createElement("input");
      radio.type = "radio";
      radio.name = q.id;
      radio.value = key;
      radio.disabled = Boolean(packet.closed);
      radio.checked = packet.answers?.[q.id] === key;
      radio.onchange = async () => {
        if (packet.closed) return;
        packet.answers = { ...packet.answers, [q.id]: key };
        packet.revision++;
        packet.dirty = true;
        try {
          await persist();
          status("Saved on this computer.");
        } catch {
          status(
            "Could not save answer. Keep this page open and contact your supervisor.",
          );
        }
      };
      label.append(
        radio,
        document.createTextNode(`${"ABCD"[i]}. ${q.options[key]}`),
      );
      $("options").append(label);
    },
  );
  $("previous").disabled = index === 0;
  $("next").disabled = index === questions.length - 1;
  $("submit").disabled = Boolean(packet.closed);
  if (packet.closed)
    status(
      packet.acknowledged
        ? "Submission received by the school LAN server."
        : "Exam closed and saved on this computer. Waiting for the LAN server.",
    );
}
let syncing = false;
async function sync() {
  if (!packet || syncing || packet.acknowledged) return;
  syncing = true;
  try {
    await writeChain;
    const result = await api("/api/save", {
      answers: packet.answers || {},
      revision: packet.revision || 0,
      deviceEpoch: packet.session.deviceEpoch || 0,
      final: Boolean(packet.closed),
      closedAtMs: packet.closedAtMs,
    });
    if (result.closed) {
      packet.closed = true;
      packet.acknowledged = true;
      packet.receipt = result.receipt;
      await persist();
      render();
    } else if (result.expiresAtMs) {
      packet.session.expiresAtMs = result.expiresAtMs;
      await persist();
      if (result.expired) await finish();
      else status("Saved to the school LAN server.");
    }
  } catch (e) {
    status(
      e.network
        ? "Saved on this computer. Waiting for the school LAN connection."
        : e.message,
    );
  } finally {
    syncing = false;
  }
}
async function finish() {
  if (!packet || packet.closed) return;
  packet.closed = true;
  packet.closedAtMs = Date.now();
  try {
    await persist();
    render();
    void sync();
  } catch {
    status(
      "Submission could not be stored. Keep this page open and contact the supervisor.",
    );
    packet.closed = false;
  }
}
$("start").onclick = start;
$("previous").onclick = () => {
  index--;
  render();
};
$("next").onclick = () => {
  index++;
  render();
};
$("submit").onclick = () => {
  if (confirm("Submit your answers? This cannot be undone.")) void finish();
};
$("retry").onclick = sync;
$("exit").onclick = () => {
  if (
    packet &&
    !packet.closed &&
    !confirm("Leave this exam? Its timer will continue.")
  )
    return;
  localStorage.removeItem("lan-active-ticket");
  release?.();
  location.reload();
};
setInterval(() => {
  if (!packet) return;
  const left = Math.max(
    0,
    Math.ceil(
      (packet.session.expiresAtMs - (Date.now() + (packet.offsetMs || 0))) /
        1000,
    ),
  );
  $("timer").textContent = packet.closed
    ? "Exam closed"
    : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} remaining`;
  if (left === 0 && !packet.closed) void finish();
}, 1000);
setInterval(() => void sync(), 30000);
window.addEventListener("online", () => void sync());
if ("serviceWorker" in navigator)
  void navigator.serviceWorker
    .register("/sw.js")
    .catch(() =>
      status(
        "Offline page installation failed. Contact your supervisor before starting.",
      ),
    );
const active = localStorage.getItem("lan-active-ticket");
if (active) {
  $("ticket").value = active;
  void start();
}
