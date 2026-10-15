import { useCallback, useMemo, useState } from "react";
import { ToastContext } from "./useToast";

let nextToastId = 1;

function normalizeToast(message, options = {}) {
  return {
    id: nextToastId++,
    message: String(message || ""),
    type: options.type || "info",
    duration: Number(options.duration || 6500),
  };
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((message, options = {}) => {
    const item = normalizeToast(message, options);
    setToasts((current) => [...current, item]);
    window.setTimeout(() => dismiss(item.id), item.duration);
    return item.id;
  }, [dismiss]);

  const api = useMemo(() => ({
    toast,
    success: (message, options) => toast(message, { ...options, type: "success" }),
    error: (message, options) => toast(message, { ...options, type: "error" }),
    info: (message, options) => toast(message, { ...options, type: "info" }),
    warning: (message, options) => toast(message, { ...options, type: "warning" }),
    dismiss,
  }), [dismiss, toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[9999] flex justify-center px-4 sm:justify-end sm:px-6" aria-live="polite" aria-atomic="true">
        <div className="flex w-full max-w-md flex-col gap-3">
          {toasts.map((item) => {
            const tone = {
              success: "border-emerald-200 bg-emerald-50 text-emerald-950",
              error: "border-rose-200 bg-rose-50 text-rose-950",
              warning: "border-amber-200 bg-amber-50 text-amber-950",
              info: "border-sky-200 bg-sky-50 text-sky-950",
            }[item.type];
            return (
              <div key={item.id} className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-xl shadow-slate-900/10 ${tone}`}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 text-sm font-medium leading-5">{item.message}</div>
                  <button type="button" onClick={() => dismiss(item.id)} className="shrink-0 rounded-md px-2 py-1 text-xs font-bold opacity-60 hover:opacity-100" aria-label="Dismiss notification">×</button>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/5">
                  <div className="h-full animate-[toast-progress_6.5s_linear_forwards] rounded-full bg-current opacity-30" style={{ animationDuration: `${item.duration}ms` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
