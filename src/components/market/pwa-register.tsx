"use client";

/** PWA registration + install button (G14). The register effect installs the
 *  service worker (app-shell cache; API never cached), and the InstallButton
 *  surfaces the browser's install prompt when available. Notifications run
 *  through the Notification API while the site is open — honest behavior for
 *  an unauthenticated, server-light PWA. */

import { useEffect, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Mount anywhere inside the provider: registers /sw.js once. */
export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration is best-effort; the site works fully without it
      });
    }
  }, []);
  return null;
}

/** Install button for the header: appears only when the browser offers it. */
export function InstallButton() {
  const { lang } = useApp();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    try {
      // one-time mount initialization (display-mode is browser-only)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    } catch {}
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent || installed) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-[11px] text-primary whitespace-nowrap"
      title={tt(T.installHint, lang)}
      onClick={async () => {
        try {
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice.outcome === "accepted") setPromptEvent(null);
        } catch {}
      }}
    >
      <Download className="h-3.5 w-3.5" />
      {tt(T.installApp, lang)}
    </Button>
  );
}
