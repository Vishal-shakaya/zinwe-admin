import type { CSSProperties, ReactElement, ReactNode } from "react";

/** Official wordmark proportions (brand-kit/logo/zinwe-logo.png is 837 × 206; the -32/-64/-96 files keep it). */
const LOGO_ASPECT = 837 / 206;

/**
 * The official Zinwe wordmark (orange Z, dark "inwe") from `.claude/marketing/brand-kit/logo/`, copied to
 * `public/brand/`, with a small "Staff" label. Used by the menu, the phone top bar and the sign-in page.
 * `extra` sits after the label (the "Dev" pill on dev hosts).
 */
export function BrandLogo({
  height = 24,
  tag = "Staff",
  extra,
  className = "",
}: {
  height?: number;
  tag?: string;
  extra?: ReactNode;
  className?: string;
}): ReactElement {
  const width = Math.round(height * LOGO_ASPECT);
  const set = (ext: string) =>
    `/brand/zinwe-logo-32.${ext} 130w, /brand/zinwe-logo-64.${ext} 260w, /brand/zinwe-logo-96.${ext} 390w` +
    (ext === "png" ? ", /brand/zinwe-logo.png 837w" : "");
  return (
    <span className={"brand " + className} style={{ "--brand-h": `${height}px` } as CSSProperties}>
      <picture className="brand__pic">
        <source type="image/webp" srcSet={set("webp")} sizes={`${width}px`} />
        <img
          className="brand__logo"
          src="/brand/zinwe-logo-96.png"
          srcSet={set("png")}
          sizes={`${width}px`}
          width={width}
          height={height}
          alt="Zinwe"
          decoding="async"
        />
      </picture>
      {tag ? <span className="brand__tag">{tag}</span> : null}
      {extra}
    </span>
  );
}

/** Small, non-interactive "Dev" pill: dev.admin.zinwe.io and local hosts only (never rendered on production). */
export function DevPill(): ReactElement {
  return (
    <span className="env-dev" title="Dev environment: test data only">
      Dev
    </span>
  );
}
