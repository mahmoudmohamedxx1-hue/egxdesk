import type { Metadata } from "next";
import { AppProvider } from "@/components/market/app-context";
import { AppShell } from "@/components/market/app-shell";

/** T40 — bilingual page metadata. The app is a single page whose language is
 *  a URL param (?lang=en), but layout.tsx's static metadata was Arabic-only,
 *  so English visitors got an Arabic tab title / bookmark / share-card / meta
 *  description. generateMetadata reads the lang param server-side so the
 *  FIRST paint (and crawlers) already matches the requested language; the
 *  AppShell effect keeps document.title/meta live when the user toggles the
 *  language client-side. (The static Arabic layout title also stays as the
 *  root default for crawlers hitting "/".) */
export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const sp = await searchParams;
  const lang = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  if (lang === "en") {
    return {
      title: "EGX Desk — Live Egyptian Exchange data",
      description:
        "Delayed live data for the Egyptian Exchange: indices, 296 listed companies with real prices and metrics, sector performance, the heatmap, Egyptian market news from public sources — local tracking with no sign-up.",
    };
  }
  return {
    title: "EGX Desk — بيانات حية للبورصة المصرية",
    description:
      "بيانات حية مؤجلة للبورصة المصرية: المؤشرات، ٢٩٦ شركة مقيدة بأسعار ومقاييس فعلية، أداء القطاعات، الخريطة الحرارية، أخبار السوق المصرية من مصادر عامة، ومتابعة محلية بلا تسجيل دخول.",
  };
}

export default function Home() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}

