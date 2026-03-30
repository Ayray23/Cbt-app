export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  tone = "danger",
}) {
  if (!open) {
    return null;
  }

  const confirmClassName =
    tone === "danger"
      ? "bg-red-600 text-white"
      : tone === "success"
        ? "bg-emerald-600 text-white"
        : "bg-slate-900 text-white";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <h3 className="text-xl font-semibold text-slate-900">{title}</h3>
        <p className="mt-3 text-sm text-slate-600">{message}</p>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${confirmClassName}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
