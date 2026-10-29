import type { ReactElement, ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { SAMPLES_ON } from "../lib/samples";

/** Loading placeholder: shimmer rows inside a card (or bare with `bare`). */
export function LoadingState({ rows = 4, label = "Loading…", bare }: { rows?: number; label?: string; bare?: boolean }): ReactElement {
  const body = (
    <div className="state" role="status" aria-live="polite" style={{ gap: 12, alignItems: "stretch" }}>
      <span className="sr">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="shimmer" style={{ height: 14, width: `${92 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
  return bare ? body : <div className="card">{body}</div>;
}

/** Nothing to show yet: an icon, one bold line, one plain line, optional action. */
export function EmptyState({
  title,
  body,
  icon = "check",
  action,
  center,
}: {
  title: ReactNode;
  body?: ReactNode;
  icon?: IconName;
  action?: ReactNode;
  center?: boolean;
}): ReactElement {
  return (
    <div className={"state" + (center ? " state--center" : "")}>
      <span className="state__icon" aria-hidden="true">
        <Icon name={icon} size={18} strokeWidth={2} />
      </span>
      <p className="state__title">{title}</p>
      {body ? <p className="state__body">{body}</p> : null}
      {action}
    </div>
  );
}

/** The API call failed: say so plainly and offer Try again. */
export function ErrorState({
  message,
  onRetry,
  title = "This page couldn’t load",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}): ReactElement {
  return (
    <div className="card">
      <div className="state state--error" role="alert">
        <span className="state__icon" aria-hidden="true">
          <Icon name="warn" size={18} strokeWidth={2} />
        </span>
        <p className="state__title">{title}</p>
        <p className="state__body">{message}</p>
        {onRetry ? (
          <button type="button" className="btn" onClick={onRetry}>
            <Icon name="refresh" />
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Marks a screen or block fed from src/content/fixtures (no API yet). Production builds (SAMPLES_ON false) hide
 * the sample blocks themselves; this renders nothing there as a last guard.
 */
export function SampleTag({ what = "Sample data" }: { what?: string }): ReactElement | null {
  if (!SAMPLES_ON) return null;
  return (
    <span className="sample-tag" title="Shown from sample data in src/content/fixtures until the API exists">
      {what}
    </span>
  );
}
