import type { CSSProperties, ReactElement } from "react";

/** Trimmed wordmark proportions (public/brand/zinwe-logo-*.png, same files as the website). */
const LOGO_ASPECT = 390 / 96;

/**
 * The founder's original Zinwe wordmark (orange Z, grey "inwe"), with the "Back office" tag.
 * Same artwork as the website and the emails; the square Z mark is the browser-tab icon.
 */
export function BrandLogo({ height = 24, className = "" }: { height?: number; className?: string }): ReactElement {
  const set = (ext: string) =>
    `/brand/zinwe-logo-32.${ext} 1x, /brand/zinwe-logo-64.${ext} 2x, /brand/zinwe-logo-96.${ext} 3x`;
  return (
    <div className={"brand " + className} style={{ "--brand-h": `${height}px` } as CSSProperties}>
      <picture>
        <source type="image/webp" srcSet={set("webp")} />
        <img
          className="brand__logo"
          src="/brand/zinwe-logo-64.png"
          srcSet={set("png")}
          width={Math.round(height * LOGO_ASPECT)}
          height={height}
          alt="Zinwe"
          decoding="async"
        />
      </picture>
      <span className="brand__tag">Back office</span>
    </div>
  );
}
