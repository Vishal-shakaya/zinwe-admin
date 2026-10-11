import type { ReactElement, ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  onReload,
  pending,
  children,
}: {
  title: string;
  subtitle?: string;
  onReload?: () => void;
  pending?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-head__title">{title}</h1>
        {subtitle ? <p className="page-head__sub">{subtitle}</p> : null}
      </div>
      <div className="page-head__actions">
        {children}
        {onReload ? (
          <button type="button" className="btn btn--ghost" onClick={onReload} disabled={pending}>
            {pending ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
    </header>
  );
}
