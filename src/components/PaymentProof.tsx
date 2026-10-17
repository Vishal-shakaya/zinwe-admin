import { useEffect, useState, type ReactElement } from "react";
import { fetchProof } from "../lib/api";

type ProofState = { url: string; type: string } | "loading" | "error";

/**
 * The customer's uploaded receipt, fetched with the staff token (it's never public), shown large enough
 * to read (J8-01): an image fits the box without cropping, a PDF opens inline. "Open full size" opens it in
 * a new tab for zooming.
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

  if (!hasProof) {
    return (
      <p className="receipt receipt--none">
        <b>No receipt was attached.</b> Check the reference and amount against your bank statement, UPI app or Skydo
        before approving.
      </p>
    );
  }
  if (state === "loading") return <div className="receipt receipt--loading" aria-label="Loading the receipt" />;
  if (state === "error") {
    return <p className="receipt receipt--none row-error">The receipt couldn't be loaded. Reload the page and try again.</p>;
  }

  const isPdf = state.type === "application/pdf";
  return (
    <figure className="receipt">
      {state.type.startsWith("image/") ? (
        <img className="receipt__img" src={state.url} alt="Payment receipt uploaded by the customer" />
      ) : isPdf ? (
        <iframe className="receipt__pdf" src={state.url} title="Payment receipt (PDF) uploaded by the customer" />
      ) : (
        <p className="receipt--none">This receipt can't be previewed here.</p>
      )}
      <figcaption className="receipt__bar">
        <span>Receipt from the customer{isPdf ? " (PDF)" : ""}</span>
        <a href={state.url} target="_blank" rel="noreferrer">
          Open full size ↗
        </a>
      </figcaption>
    </figure>
  );
}
