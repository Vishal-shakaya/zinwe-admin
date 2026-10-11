import { createContext, useCallback, useContext, useState, type ReactElement, type ReactNode } from "react";
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
