"use client";

/** PWA registration + install entry (G14). The register effect installs the
 *  service worker (app-shell cache; API never cached). The InstallButton is
 *  a ALWAYS-VISIBLE footer link: when the browser offers the native install
 *  prompt it triggers it directly; otherwise it opens step-by-step
 *  instructions for the detected platform (iOS Safari, Android Chrome,
 *  desktop Chrome/Edge/Safari) so the link is useful on every browser.
 *  Notifications run through the Notification API while the site is open —
 *  honest behavior for an unauthenticated, server-light PWA. */

import { useEffect, useState } from "react";
import { useApp } from "./app-context";
import { T, tt } from "@/lib/i18n";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Download, Smartphone, MonitorSmartphone, Check } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Platform = "ios" | "android" | "desktopChrome" | "desktopSafari" | "other";

function detectPlatform(): Platform {
  try {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (iOS) return "ios";
    if (/Android/.test(ua)) return "android";
    if (/Firefox/.test(ua)) return "other";
    if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return "desktopSafari";
    return "desktopChrome";
  } catch {
    return "other";
  }
}

/** Mount anywhere inside the provider: registers /sw.js once, then keeps
 *  watching for new versions (periodic registration.update() + updatefound)
 *  so an installed app that has been suspended on a phone still notices a
 *  release, applies it via SKIP_WAITING and reloads once (guarded). */
export function PwaRegister() {
  const { toast, lang } = useApp();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let reloaded = false;
    let reg: ServiceWorkerRegistration | null = null;

    const onControllerChange = () => {
      // a new SW took control — reload ONCE to run the new shell
      if (reloaded) return;
      reloaded = true;
      try {
        window.location.reload();
      } catch {}
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      reg = registration;
      registration.addEventListener("updatefound", () => {
        const sw = registration.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            toast(
              lang === "ar"
                ? "يتوفر إصدار جديد من التطبيق — جارٍ التحديث…"
                : "A new app version is available — updating…"
            );
            sw.postMessage("SKIP_WAITING");
          }
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then(watch)
      .catch(() => {
        // SW registration is best-effort; the site works fully without it
      });
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // periodic update checks keep suspended installed apps fresh
    const check = () => {
      try {
        reg?.update().catch(() => {});
      } catch {}
    };
    const first = setTimeout(check, 30_000);
    const t = setInterval(check, 30 * 60_000);

    return () => {
      clearTimeout(first);
      clearInterval(t);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [toast, lang]);
  return null;
}

/** Footer install link — always present (hidden only when already installed
 *  or after an accepted install), so users can always find it. */
export function InstallButton() {
  const { lang } = useApp();
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);

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

  if (installed) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-up">
        <Check className="h-3 w-3" />
        {tt(T.installed, lang)}
      </span>
    );
  }

  const platform = detectPlatform();

  const steps: Record<Platform, { ar: string; en: string }> = {
    ios: {
      ar: "على آيفون/آيباد: افتح في سفاري ← زر المشاركة (المربع مع السهم) ← \"إضافة إلى الشاشة الرئيسية\".",
      en: "On iPhone/iPad: open in Safari → Share button (square with arrow) → \"Add to Home Screen\".",
    },
    android: {
      ar: "على أندرويد: افتح القائمة (⋮) في كروم ← \"تثبيت التطبيق\" (أو \"إضافة إلى الشاشة الرئيسية\").",
      en: "On Android: open the Chrome menu (⋮) → \"Install app\" (or \"Add to Home screen\").",
    },
    desktopChrome: {
      ar: "على الكمبيوتر: اضغط أيقونة التثبيت (شاشة مع سهم لأسفل) في أقصى يمين شريط العنوان في كروم/إيدج.",
      en: "On desktop: click the install icon (screen with a down arrow) at the right end of the address bar in Chrome/Edge.",
    },
    desktopSafari: {
      ar: "في سفاري على ماك: قائمة \"ملف\" ← \"أضف إلى Dock\".",
      en: "In Safari on macOS: File menu → \"Add to Dock\".",
    },
    other: {
      ar: "متصفحك لا يدعم التثبيت المباشر — افتح الموقع في كروم أو سفاري ثم اتبع خطوات التثبيت فيه.",
      en: "Your browser does not support direct install — open the site in Chrome or Safari and follow its install steps.",
    },
  };

  const label = tt(T.installApp, lang);

  // Native prompt available → one click installs directly.
  if (promptEvent) {
    return (
      <button
        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        title={tt(T.installHint, lang)}
        onClick={async () => {
          try {
            await promptEvent.prompt();
            const choice = await promptEvent.userChoice;
            if (choice.outcome === "accepted") setPromptEvent(null);
          } catch {}
        }}
      >
        <Download className="h-3 w-3" />
        {label}
      </button>
    );
  }

  // No native prompt (iOS, some browsers) → the link opens instructions.
  return (
    <Popover open={hintOpen} onOpenChange={setHintOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" title={tt(T.installHint, lang)}>
          <Download className="h-3 w-3" />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-2">
        <p className="text-xs font-semibold flex items-center gap-1.5">
          <MonitorSmartphone className="h-3.5 w-3.5 text-primary" />
          {label}
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{tt(T.installHint, lang)}</p>
        <div className="rounded-md border bg-secondary/40 p-2 flex gap-2 items-start">
          {platform === "ios" || platform === "android" ? (
            <Smartphone className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
          ) : (
            <MonitorSmartphone className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden />
          )}
          <p className="text-[11px] leading-relaxed">{tt(steps[platform], lang)}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
