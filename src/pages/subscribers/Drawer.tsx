import { useEffect, useRef, type ReactElement, type ReactNode } from "react";

/**
 * The board's right-side customer panel (620 px, full width on phones) on the native <dialog>: focus is trapped,
 * Esc closes, the page behind is inert. A click on the dimmed page closes it (nothing is typed in the panel
 * that can't be found again: drafts live in the panel's own state until it closes).
 */
export function Drawer({
  labelledBy,
  onClose,
  head,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  head: ReactNode;
  children: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sb-drawer"
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // The backdrop is the <dialog> itself; the panel stops the click.
        if (e.target === ref.current) onClose();
      }}
    >
      <aside className="sb-drawer__panel">
        <div className="sb-drawer__head">{head}</div>
        <div className="sb-drawer__body">{children}</div>
      </aside>
    </dialog>
  );
}
