"use client";

/** Header share button (Task 21-c): copies the CURRENT url — which always
 *  carries the page's state params (view, tab, filters, tickers, lang) — so
 *  whoever opens the link lands on the same page in the same state.
 *  On phones it prefers the native share sheet; elsewhere clipboard. */

import { useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { currentShareUrl, copyText } from "@/lib/url-state";
import { Button } from "@/components/ui/button";
import { Check, Share2 } from "lucide-react";

export function ShareButton() {
  const { lang, toast } = useApp();
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = currentShareUrl();
    if (!url) return;
    // 1) native share sheet on phones (has rich targets: WhatsApp…)
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: tt(T.shareTitle, lang), url });
        return;
      } catch {
        /* user dismissed the sheet — fall back to clipboard copy */
      }
    }
    // 2) clipboard copy everywhere else
    const ok = await copyText(url);
    if (ok) {
      toast(tt(T.shareCopied, lang));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      toast(tt(T.shareFailed, lang));
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void share()}
      aria-label={tt(T.sharePage, lang)}
      title={tt(T.sharePage, lang)}
      className="gap-1.5"
    >
      {copied ? <Check className="h-4 w-4 text-up" /> : <Share2 className="h-4 w-4" />}
      <span className="hidden md:inline text-xs">{tt(T.sharePage, lang)}</span>
    </Button>
  );
}
