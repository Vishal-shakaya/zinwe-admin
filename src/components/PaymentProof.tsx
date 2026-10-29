import { useEffect, useState, type ReactElement } from "react";
import { ApiError, fetchProof } from "../lib/api";
import "../styles/payment-proof.css";

type ProofState = { url: string; type: string; size: number } | "loading" | "error" | "missing";

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * The customer's uploaded receipt, fetched with the staff token (it's never public), shown large enough to read
 * (J8-01) on the board's striped tray: an image fits without cropping, a PDF opens inline. "Open full size" opens
 * it in a new tab for zooming.
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
        if (alive) setState({ url, type: blob.type, size: blob.size });
      })
      .catch((e: unknown) => {
        // 404 = the payment says a receipt was sent but the file isn't on the server: reloading won't help.
        if (alive) setState(e instanceof ApiError && e.status === 404 ? "missing" : "error");
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [paymentId, hasProof]);

  if (!hasProof) {
    return (
      <figure className="pproof">
        <div className="pproof__tray pproof__tray--note">
          <p>
            <b>No receipt was attached.</b> Check the reference and amount against the bank statement, UPI app or Skydo
            before approving.
          </p>
        </div>
      </figure>
    );
  }
  if (state === "loading") {
    return (
      <figure className="pproof" aria-busy="true">
        <div className="pproof__tray">
          <span className="pproof__loading shimmer" aria-label="Loading the receipt" />
        </div>
      </figure>
    );
  }
  if (state === "missing") {
    return (
      <figure className="pproof">
        <div className="pproof__tray pproof__tray--note">
          <p className="pproof__err" role="alert">
            <b>The receipt file is missing on the server.</b> Check the amount and reference against the bank
            statement, UPI app or Skydo, or ask the customer to send the receipt again.
          </p>
        </div>
      </figure>
    );
  }
  if (state === "error") {
    return (
      <figure className="pproof">
        <div className="pproof__tray pproof__tray--note">
          <p className="pproof__err" role="alert">
            The receipt couldn’t be loaded. Reload the page and try again.
          </p>
        </div>
      </figure>
    );
  }

  const isPdf = state.type === "application/pdf";
  return (
    <figure className="pproof">
      <div className="pproof__tray">
        {state.type.startsWith("image/") ? (
          <img className="pproof__img" src={state.url} alt="Payment receipt uploaded by the customer" />
        ) : isPdf ? (
          <iframe className="pproof__pdf" src={state.url} title="Payment receipt (PDF) uploaded by the customer" />
        ) : (
          <p>This receipt can’t be previewed here.</p>
        )}
      </div>
      <figcaption className="k pproof__bar">
        <span>
          Receipt from the customer · {isPdf ? "PDF" : "image"} · {kb(state.size)}
        </span>
        <a className="btn sm" href={state.url} target="_blank" rel="noreferrer">
          Open full size
        </a>
      </figcaption>
    </figure>
  );
}
