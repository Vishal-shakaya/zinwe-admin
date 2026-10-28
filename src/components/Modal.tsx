import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
import { Icon } from "./icons";

/**
 * Accessible modal on the native <dialog>: focus is trapped, Esc closes, the page behind is inert.
 * Clicking the dimmed backdrop does NOT close it (a stray click must never throw away a half-filled form):
 * only the × button, Cancel (via `onClose`) or Esc do.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
  role,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action bar at the bottom (stays visible while the body scrolls). */
  footer?: ReactNode;
  /** "small" for confirmations; "drawer" slides in from the right (Subscribers customer panel). */
  size?: "small" | "drawer";
  /** "alertdialog" for a yes/no decision that interrupts (env switch, approve). */
  role?: "dialog" | "alertdialog";
  /** Extra class on the <dialog> (page-specific sizing). */
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // No close() in a cleanup: StrictMode's mount-unmount-mount would queue a "close" event that
  // fires after the remount and shuts the modal. Unmounting removes the dialog from the top layer anyway.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={"modal" + (size ? ` modal--${size}` : "") + (className ? ` ${className}` : "")}
      aria-labelledby={titleId}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal__panel">
        <header className="modal__head">
          <div>
            <h2 className="modal__title" id={titleId}>
              {title}
            </h2>
            {subtitle ? <div className="modal__sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} strokeWidth={2} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
