export default function StatusBanner({ tone = "info", message, onClose }) {
  if (!message) {
    return null;
  }

  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700",
    error: "border-red-200 bg-red-50 text-red-700",
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <p>{message}</p>
        {onClose && (
          <button onClick={onClose} className="text-xs font-semibold uppercase tracking-[0.2em]">
            Close
          </button>
        )}
      </div>
    </div>
  );
}
