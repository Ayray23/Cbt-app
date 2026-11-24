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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4" role="presentation">
      <section ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby="staff-session-title"
        aria-describedby="staff-session-description"
        className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
        <p className="text-sm font-bold uppercase tracking-wide text-amber-700">Session expiring</p>
        <h2 id="staff-session-title" className="mt-2 text-xl font-bold">Are you still there?</h2>
        <p id="staff-session-description" className="mt-3 text-sm text-slate-600">
          For security, your staff session will automatically sign out after inactivity.
          Select <strong>Stay signed in</strong> to cancel the countdown.
        </p>
        <p className="my-5 text-center text-5xl font-extrabold tabular-nums text-red-700"
          aria-live="off" aria-label={`${seconds} seconds remaining`}>
          {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
        </p>
        {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="button" autoFocus onClick={stay} disabled={seconds === 0}
            className="ui-btn-primary flex-1">Stay signed in</button>
          <button type="button" onClick={() => void Promise.resolve(logout()).catch(() => setError("Sign-out failed. Try again."))}
            className="ui-btn-secondary">Sign out now</button>
        </div>
      </section>
    </div>
  );
}
