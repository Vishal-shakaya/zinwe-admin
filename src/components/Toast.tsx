import { createContext, useCallback, useContext, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Tone = "good" | "bad";
interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** `const toast = useToast(); toast("Remark saved.")` — a short confirmation, bottom-right. */
export function useToast(): (text: string, tone?: Tone) => void {
  return useContext(ToastContext);
}

let nextId = 1;

/**
 * Where toasts render: inside the top-most open modal <dialog> if there is one (everything
 * outside a modal sits under its backdrop and is inert), otherwise the page.
 */
function toastHost(): Element {
  const open = document.querySelectorAll("dialog[open]");
  return open.length ? open[open.length - 1] : document.body;
}

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  // The host is picked at render time; when the dialog it sat in closes (a confirmation that just
  // succeeded), render again so the toast moves to the page instead of vanishing with the dialog.
  const [, setHostVersion] = useState(0);
  const showing = items.length > 0;
  useEffect(() => {
    if (!showing) return;
    const bump = () => setHostVersion((v) => v + 1);
    const observer = new MutationObserver(bump);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] });
    const frame = window.requestAnimationFrame(bump);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [showing]);

  const show = useCallback((text: string, tone: Tone = "good") => {
    const id = nextId++;
    setItems((cur) => [...cur.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "bad" ? 6000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {items.length
        ? createPortal(
            <div className="toasts" role="status" aria-live="polite">
              {items.map((t) => (
                <div key={t.id} className={"toast toast--" + t.tone}>
                  <span className="toast__dot" aria-hidden="true" />
                  {t.text}
                </div>
              ))}
            </div>,
            toastHost(),
          )
        : null}
    </ToastContext.Provider>
  );
}
