import { useEffect, useRef, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "/firebase";
import { callApi } from "../services/api";
import StatusBanner from "../components/StatusBanner";
export default function LanExams() {
  const [grants, setGrants] = useState([]);
  const [exams, setExams] = useState([]),
    [students, setStudents] = useState([]),
    [examId, setExamId] = useState(""),
    [selected, setSelected] = useState([]),
    [busy, setBusy] = useState(false),
    [banner, setBanner] = useState(null),
    [bundle, setBundle] = useState(null);
  const request = useRef(null);
  useEffect(() => {
    callApi("lan.list")
      .then((r) => setGrants(r.grants))
      .catch((e) => setBanner({ tone: "error", message: e.message }));
  }, []);
  useEffect(
    () =>
      onSnapshot(
        query(
          collection(db, "exams"),
          where("status", "==", "published"),
          limit(100),
        ),
        (s) => setExams(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      ),
    [],
  );
  const exam = exams.find((e) => e.id === examId);
  useEffect(() => {
    if (!exam?.className) return undefined;
    return onSnapshot(
      query(
        collection(db, "users"),
        where("role", "==", "student"),
        where("className", "==", exam.className),
      ),
      (s) =>
        setStudents(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter(
              (s) =>
                s.academicSession === exam.academicSession &&
                s.subjects?.includes(exam.subject) &&
                !s.loginDisabled,
            ),
        ),
    );
  }, [exam]);
  async function prepare() {
    setBusy(true);
    try {
      request.current ||= crypto.randomUUID();
      const value = await callApi("lan.export", {
        examId,
        studentIds: selected,
        requestId: request.current,
      });
      setBundle(value);
      setBanner({
        tone: "success",
        message:
          "LAN attempts reserved. Download the private bundle and import it on the school server. These students must use the LAN address for this paper.",
      });
    } catch (e) {
      setBanner({ tone: "error", message: e.message });
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `lan-${bundle.grantId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="bg-white p-6 rounded-2xl space-y-4">
      <h2 className="text-2xl font-semibold">
        Prepare offline LAN examination
      </h2>
      <StatusBanner {...banner} />
      <details>
        <summary>
          Recover an existing private bundle (up to 100 records)
        </summary>
        {grants.map((g) => (
          <p key={g.id}>
            {g.examId} · {g.candidates} candidates{" "}
            <button
              onClick={async () => {
                try {
                  setBundle(await callApi("lan.download", { grantId: g.id }));
                } catch (e) {
                  setBanner({ tone: "error", message: e.message });
                }
              }}
            >
              Open bundle {g.id}
            </button>
          </p>
        ))}
      </details>
      <p>
        Prepare while online. The school computer serves the exam over trusted
        HTTPS, stores submissions locally, and uploads them later. Never give
        the bundle to students: it includes the server synchronization
        credential and every selected student's ticket. Give each student only
        their own ticket.
      </p>
      <label>
        Published paper
        <select
          className="block border p-3"
          disabled={busy || Boolean(bundle)}
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value);
            setSelected([]);
            request.current = null;
          }}
        >
          <option value="">Select paper</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} · {e.className}
            </option>
          ))}
        </select>
      </label>
      <p>
        Select up to 100 candidates per bundle. Preparing a bundle reserves
        these attempts so students cannot start a duplicate cloud exam.
      </p>
      {exam &&
        students.map((s) => (
          <label key={s.id} className="block">
            <input
              type="checkbox"
              disabled={busy || Boolean(bundle)}
              checked={selected.includes(s.id)}
              onChange={(e) => {
                request.current = null;
                setSelected(
                  e.target.checked
                    ? [...selected, s.id]
                    : selected.filter((id) => id !== s.id),
                );
              }}
            />{" "}
            {s.displayName} · {s.username}
          </label>
        ))}
      <button
        className="border p-3"
        disabled={
          busy || !selected.length || selected.length > 100 || Boolean(bundle)
        }
        onClick={prepare}
      >
        {busy ? "Preparing…" : "Reserve and prepare bundle"}
      </button>
      {bundle && (
        <>
          <button className="border p-3" onClick={download}>
            Download private LAN bundle
          </button>
          <button className="border p-3" onClick={() => window.print()}>
            Print candidate tickets
          </button>
          <div>
            {bundle.candidates.map((c) => (
              <article
                key={c.uid}
                className="border p-4 my-3 break-inside-avoid"
              >
                <strong>{c.name}</strong>
                <p>
                  {bundle.title} · {c.username}
                </p>
                <p>
                  Personal LAN ticket: <code>{c.ticket}</code>
                </p>
              </article>
            ))}
          </div>
          <button
            onClick={() => {
              setBundle(null);
              setSelected([]);
              request.current = null;
            }}
          >
            Prepare next group
          </button>
        </>
      )}
    </section>
  );
}
