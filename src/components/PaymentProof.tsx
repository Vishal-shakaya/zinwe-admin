import { useEffect, useState, type ReactElement } from "react";
import { fetchProof } from "../lib/api";

type ProofState = { url: string; type: string } | "loading" | "error";

/**
 * The customer's uploaded receipt, fetched with the staff token (it's never public).
 * Images preview inline (click for full size); PDFs open in a new tab.
 */
export function PaymentProof({ paymentId, hasProof }: { paymentId: number; hasProof: boolean }): ReactElement {
  const [state, setState] = useState<ProofState>("loading");

  useEffect(() => {
    if (!hasProof) return;
    let alive = true;
    let url: string | null = null;
    setState("loading");
    fetchProof(paymentId)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (alive) setState({ url, type: blob.type });
      })
      .catch(() => {
        if (alive) setState("error");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [paymentId, hasProof]);

  if (!hasProof) return <p className="proof proof--none">No proof file was attached.</p>;
  if (state === "loading") return <div className="proof proof--loading" aria-label="Loading proof" />;
  if (state === "error") return <p className="proof proof--none row-error">The proof file couldn't be loaded.</p>;

  return state.type.startsWith("image/") ? (
    <a className="proof" href={state.url} target="_blank" rel="noreferrer" title="Open full size">
      <img className="proof__img" src={state.url} alt="Payment proof uploaded by the customer" />
    </a>
  ) : (
    <a className="btn btn--ghost btn--sm" href={state.url} target="_blank" rel="noreferrer">
      Open proof (PDF)
    </a>
  );
}
