import { useEffect } from "react";
import { toast } from "../utils/toast";

export default function StatusBanner({ tone = "info", message, onClose }) {
  useEffect(() => {
    if (tone === "error" && message) toast.error(message);
  }, [message, tone]);

  // Errors are always displayed in the global React toast viewport.
  if (!message || tone === "error") return null;

  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone] || tones.info}`}>
      <div className="flex items-start justify-between gap-3">
        <p>{message}</p>
        {onClose && (
          <button type="button" onClick={onClose} className="text-xs font-semibold uppercase tracking-[0.2em]">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
