import { useEffect, useId, useRef } from "react";

/**
 * Accessible reusable dialog surface for staff workflows.
 * Native HTML close controls are available in every modal. High-stakes
 * actions still require an explicit confirmation button.
 */
export default function ModalShell({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = "md",
}) {
  const id = useId();
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
      // Keep keyboard focus in the dialog while it is open.
      if (event.key === "Tab") {
        const dialog = closeRef.current?.closest('[role="dialog"]');
        const elements = [...(dialog?.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]',
        ) || [])].filter((element) => element.getClientRects().length);
        if (!elements.length) return;
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div
      className="ui-dialog-backdrop print:hidden"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        className={`ui-dialog ${size === "lg" ? "max-w-2xl" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ui-eyebrow">School CBT workspace</p>
            <h2 id={`${id}-title`} className="mt-2 text-xl font-extrabold text-slate-950">
              {title}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xl text-slate-700 hover:bg-slate-200"
          >
            ×
          </button>
        </div>
        {description && <p id={`${id}-description`} className="mt-3 text-sm leading-6 text-slate-600">{description}</p>}
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-5">{footer}</div>}
      </section>
    </div>
  );
}
