"use client";

/** T34 — FAST LOAD: the AI assistant (875 lines + framer-motion + the
 *  markdown renderer, ~800KB of dev JS) used to ship with EVERY first page
 *  load even though it only appears on Ctrl+K / orb click. This wrapper
 *  keeps a featherweight orb + hotkey listener mounted, and loads the real
 *  panel chunk on FIRST OPEN (ssr:false — it is a dialog, never part of the
 *  prerendered page). Once mounted it stays mounted so the chat history
 *  survives close/open exactly like before. */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";

const AssistantPanel = dynamic(
  () => import("./ai-assistant").then((m) => ({ default: m.AiAssistant })),
  { ssr: false },
);

export function AiAssistantLazy() {
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  // the heavy panel mounts on first open and never unmounts afterwards
  // (its own orb takes over while closed; chat state survives)
  const [mounted, setMounted] = useState(false);

  // every path that opens the panel also mounts it — the state change lives
  // in the event handler (not an effect), per react-hooks/set-state-in-effect
  const openPanel = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPanel]);

  return (
    <>
      {/* the featherweight launcher orb — shown only until the real panel
          has mounted once (afterwards the panel renders its own orb) */}
      {!mounted && !open && (
        <button
          onClick={openPanel}
          aria-label={tt(T.aiAssistOpen, lang)}
          title={tt(T.aiAssistOpen, lang)}
          className="ai-orb fixed z-40 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] end-5 flex h-12 w-12 items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95"
        >
          <Sparkles className="h-5 w-5" aria-hidden />
        </button>
      )}
      {mounted && <AssistantPanel open={open} setOpen={setOpen} />}
    </>
  );
}
