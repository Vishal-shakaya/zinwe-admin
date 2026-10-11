import { useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";

/**
 * Accessible modal on the native <dialog>: focus is trapped, Esc closes, the page behind is inert.
 * Clicking the dimmed backdrop also closes it.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  size,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Sticky action bar at the bottom (stays visible while the body scrolls). */
  footer?: ReactNode;
  /** "small" for confirmations. */
  size?: "small";
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
      className={"modal" + (size ? ` modal--${size}` : "")}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop
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
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__foot">{footer}</footer> : null}
      </div>
    </dialog>
  );
}
