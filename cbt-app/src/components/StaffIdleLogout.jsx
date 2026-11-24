import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { idlePhase, secondsLeft, STAFF_IDLE_MS, STAFF_WARNING_MS } from "../utils/staffIdle.mjs";

const STAFF_ROLES = new Set(["superadmin", "admin", "teacher", "invigilator"]);
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"];

function readActivity(key) {
  try {
    const value = Number(window.localStorage.getItem(key));
    // Ignore corrupt or future values. Storage may be unavailable in private mode.
    if (Number.isFinite(value) && value > 0 && value <= Date.now()) return value;
  } catch { /* Use in-memory activity instead. */ }
  return Date.now();
}

export default function StaffIdleLogout() {
  const { user, role, logout } = useAuth();
  const isStaff = Boolean(user && STAFF_ROLES.has(role));
  const [seconds, setSeconds] = useState(null);
  const [error, setError] = useState("");
  const lastActivity = useRef(Date.now());
  const warning = useRef(false);
  const signingOut = useRef(false);
  const logoutRef = useRef(logout);
  const dialogRef = useRef(null);
  logoutRef.current = logout;

  useEffect(() => {
    if (!isStaff) return undefined;
    const key = `cbt_staff_last_activity:${user.uid}`;
    lastActivity.current = readActivity(key);
    warning.current = false;
    signingOut.current = false;

    const storeActivity = (timestamp) => {
      lastActivity.current = timestamp;
      try { window.localStorage.setItem(key, String(timestamp)); }
      catch { /* The local timer continues if browser storage is disabled. */ }
    };
    if (Date.now() - lastActivity.current > STAFF_IDLE_MS + STAFF_WARNING_MS) {
      // Stale session from an idle browser that was closed or refreshed.
      warning.current = true;
    } else {
      storeActivity(lastActivity.current);
    }

    const activity = () => {
      // Only the explicit Stay signed in button can dismiss an open warning.
      if (warning.current || signingOut.current) return;
      const now = Date.now();
      if (now - lastActivity.current >= STAFF_IDLE_MS) {
        check();
        return;
      }
      if (now - lastActivity.current >= 1000) storeActivity(now);
    };
    const fromOtherTab = (event) => {
      if (event.key !== key || signingOut.current) return;
      const stamp = Number(event.newValue);
      if (!Number.isFinite(stamp) || stamp <= lastActivity.current || stamp > Date.now()) return;
      lastActivity.current = stamp;
      if (warning.current) {
        warning.current = false;
        setSeconds(null);
      }
    };
    const check = () => {
      if (signingOut.current) return;
      const now = Date.now();
      const phase = idlePhase(lastActivity.current, now);
      if (phase === "expired") {
        signingOut.current = true;
        setSeconds(0);
        void Promise.resolve(logoutRef.current()).catch(() => {
          signingOut.current = false;
          setError("Automatic sign-out failed. Please select Sign out now.");
        });
      } else if (phase === "warning") {
        warning.current = true;
        setSeconds(secondsLeft(lastActivity.current + STAFF_IDLE_MS + STAFF_WARNING_MS, now));
      } else {
        warning.current = false;
        setSeconds(null);
      }
    };

    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, activity, { passive: true });
    window.addEventListener("storage", fromOtherTab);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const protectModal = (event) => {
      if (!warning.current) return;
      if (event.key === "Escape") event.preventDefault();
      if (event.key !== "Tab") return;
      const controls = [...(dialogRef.current?.querySelectorAll("button:not([disabled])") || [])];
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", protectModal);
    const ticker = window.setInterval(check, 1000);
    check();

    return () => {
      window.clearInterval(ticker);
      window.removeEventListener("keydown", protectModal);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, activity);
      window.removeEventListener("storage", fromOtherTab);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [isStaff, user?.uid]);

  if (!isStaff || seconds === null) return null;

  const stay = () => {
    const key = `cbt_staff_last_activity:${user.uid}`;
    const timestamp = Date.now();
    lastActivity.current = timestamp;
    try { window.localStorage.setItem(key, String(timestamp)); }
    catch { /* Continue in memory. */ }
    warning.current = false;
    signingOut.current = false;
    setError("");
    setSeconds(null);
  };
  return (
    <div
      className="fixed inset-0 z-[9999] flex min-h-[100dvh] items-center justify-center overflow-y-auto bg-slate-950/90 px-3 py-6 backdrop-blur-md sm:px-6"
      role="presentation"
    >
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="staff-session-title"
        aria-describedby="staff-session-description"
        className="relative my-auto w-full max-w-3xl overflow-hidden rounded-3xl border-4 border-amber-400 bg-white p-6 text-center text-slate-950 shadow-2xl shadow-black/50 sm:p-10 lg:p-12"
      >
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-3 bg-amber-400" />
        <div
          aria-hidden="true"
          className="mx-auto mt-2 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 text-5xl text-amber-800 ring-4 ring-amber-200 sm:h-24 sm:w-24 sm:text-6xl"
        >
          ⚠
        </div>
        <p className="mt-6 text-lg font-black uppercase tracking-[0.15em] text-red-700 sm:text-2xl">
          Automatic logout warning
        </p>
        <h2 id="staff-session-title" className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:text-5xl">
          Are you still there?
        </h2>
        <p id="staff-session-description" className="mx-auto mt-5 max-w-xl text-base font-medium leading-relaxed text-slate-700 sm:text-xl">
          Your staff session is about to end because of inactivity.
          Press <strong>Stay signed in</strong> to cancel automatic logout.
        </p>
        <div className="mx-auto my-6 max-w-lg rounded-3xl border-2 border-red-200 bg-red-50 px-3 py-5 sm:my-8 sm:px-6 sm:py-7">
          <p className="text-sm font-black uppercase tracking-widest text-red-800 sm:text-lg">
            Time remaining
          </p>
          <p
            className="mt-2 text-[clamp(4.25rem,14vw,8.5rem)] font-black leading-none tracking-tight tabular-nums text-red-700"
            aria-live="off"
            aria-label={`${seconds} seconds remaining`}
            role="timer"
          >
            {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
          </p>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-100 p-3 text-base font-bold text-red-800">{error}</p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            autoFocus
            onClick={stay}
            disabled={seconds === 0}
            className="min-h-16 flex-1 rounded-2xl bg-[#253371] px-6 py-4 text-lg font-black text-white shadow-lg transition hover:bg-blue-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500 disabled:cursor-not-allowed disabled:opacity-50 sm:text-xl"
          >
            Stay signed in
          </button>
          <button
            type="button"
            onClick={() => void Promise.resolve(logout()).catch(() => setError("Sign-out failed. Try again."))}
            className="min-h-16 rounded-2xl border-2 border-slate-300 bg-slate-100 px-6 py-4 text-lg font-bold text-slate-900 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-amber-500 sm:text-xl"
          >
            Sign out now
          </button>
        </div>
      </section>
    </div>
  );
}
