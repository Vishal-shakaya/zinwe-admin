import { useCallback, useEffect, useState } from "react";
import { ApiError } from "./api";

interface LoadState<T> {
  data: T | undefined;
  error: string | null;
  pending: boolean;
  reload: () => void;
  setData: (value: T) => void;
}

/** Run an async loader on mount, exposing {data, error, pending, reload}. */
export function useLoad<T>(loader: () => Promise<T>): LoadState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const [nonce, setNonce] = useState(0);

  const run = useCallback(() => {
    let alive = true;
    setPending(true);
    setError(null);
    loader()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiError ? err.message : "Couldn't load this.");
      })
      .finally(() => {
        if (alive) setPending(false);
      });
    return () => {
      alive = false;
    };
  }, [loader, nonce]);

  useEffect(run, [run]);

  return { data, error, pending, reload: () => setNonce((n) => n + 1), setData };
}
