import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 12;

/**
 * A small panel anchored to a trigger (like a tooltip you can type in). Rendered in a portal with
 * fixed positioning so a scrolling table never clips it; flips above the trigger when there's no
 * room below. Esc or a click outside closes it, and focus goes back to the trigger.
 */
export function Popover({
  anchor,
  onClose,
  title,
  width = 320,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  title: string;
  width?: number;
  children: ReactNode;
}): ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);

  const place = useCallback(() => {
    const a = anchor.getBoundingClientRect();
    const h = panel.current?.offsetHeight ?? 0;
    const w = Math.min(width, window.innerWidth - EDGE * 2);
    const roomBelow = window.innerHeight - a.bottom;
    const above = roomBelow < h + GAP + EDGE && a.top > roomBelow;
    const top = above ? a.top - h - GAP : a.bottom + GAP;
    const left = Math.min(Math.max(EDGE, a.left), window.innerWidth - w - EDGE);
    setPos({ top: Math.max(EDGE, top), left, above });
  }, [anchor, width]);

  useLayoutEffect(place, [place]);

  const close = useCallback(() => {
    onClose();
    anchor.focus();
  }, [onClose, anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panel.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true); // capture: the table card scrolls too
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, onClose, close, place]);

  return createPortal(
    <div
      ref={panel}
      className={"pop" + (pos?.above ? " pop--above" : "")}
      role="dialog"
      aria-label={title}
      style={{ width: Math.min(width, window.innerWidth - EDGE * 2), top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="pop__title">{title}</div>
      {children}
    </div>,
    document.body,
  );
}
