"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Fetch live JSON from an API route and keep it fresh:
 *  refetches on mount, on window focus and on a fixed interval. */
export function useLiveData<T>(url: string, intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as T;
      if (mounted.current) {
        setData(json);
        setError(false);
      }
    } catch {
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    const t = setInterval(refresh, intervalMs);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh };
}
