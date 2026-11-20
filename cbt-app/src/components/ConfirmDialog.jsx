import ModalShell from "./ModalShell";

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
  const confirmClassName =
    tone === "danger" ? "ui-btn-danger"
      : tone === "success" ? "ui-btn-primary"
        : "ui-btn-primary";

  return (
    <ModalShell
      open={open}
      title={title}
      description={message}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className="ui-btn-secondary">
            {cancelLabel}
          </button>
          <button type="button" onClick={onConfirm} className={confirmClassName}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {tone === "danger" && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
          Please review the action before continuing.
        </p>
      )}
    </ModalShell>
  );
}
