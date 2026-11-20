import { useEffect, useState } from "react";
import { TOAST_EVENT } from "../utils/toast";

const styles = {
  error: "border-red-300 bg-white text-red-950 before:bg-red-600",
  success: "border-emerald-200 bg-white text-emerald-950 before:bg-emerald-600",
  warning: "border-amber-300 bg-white text-amber-950 before:bg-amber-500",
  info: "border-sky-200 bg-white text-slate-900 before:bg-sky-600",
};
let notificationId = 0;

export default function ToastViewport() {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    function received(event) {
      const tone = event.detail?.tone || "info";
      const message = String(event.detail?.message || "").trim();
      if (!message) return;
      const id = ++notificationId;
      setNotifications((prev) => [...prev.filter((item) => item.message !== message), { id, tone, message }].slice(-4));
    }
    window.addEventListener(TOAST_EVENT, received);
    return () => window.removeEventListener(TOAST_EVENT, received);
  }, []);

  useEffect(() => {
    if (!notifications.length) return undefined;
    const timers = notifications.map(({ id, tone }) =>
      window.setTimeout(
        () => setNotifications((list) => list.filter((item) => item.id !== id)),
        tone === "error" ? 11000 : tone === "warning" ? 9000 : 6500,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [notifications]);

  return (
    <div
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-3 sm:inset-x-auto sm:right-5 sm:w-[min(420px,calc(100%-2rem))]"
    >
      {notifications.map(({ id, tone, message }) => (
        <div
          key={id}
          role={tone === "error" ? "alert" : "status"}
          className={`pointer-events-auto relative flex w-full items-start gap-3 overflow-hidden rounded-xl border p-4 pl-5 shadow-xl shadow-slate-950/15 before:absolute before:inset-y-0 before:left-0 before:w-1 ${styles[tone] || styles.info}`}
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-lg font-bold">
            {tone === "error" ? "!" : tone === "success" ? "✓" : tone === "warning" ? "!" : "i"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{tone === "error" ? "Action failed" : tone === "success" ? "Success" : tone === "warning" ? "Attention" : "Notice"}</p>
            <p className="mt-1 break-words text-sm leading-relaxed">{message}</p>
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setNotifications((list) => list.filter((item) => item.id !== id))}
            className="shrink-0 rounded-md px-2 py-1 text-lg hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >×</button>
        </div>
      ))}
    </div>
  );
}
