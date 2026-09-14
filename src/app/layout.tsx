import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono, IBM_Plex_Sans, Lora, Amiri } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

/* Task 22-b — the serif voice of the AI answers (the Claude-look): Lora is
 * the Latin serif (closest open equivalent of Claude's Tiempos), Amiri is
 * the classic Naskh serif for Arabic answers. Font fallback is per-glyph,
 * so a mixed Arabic/Latin answer sets each script in its own serif. */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "EGX Desk — بيانات حية للبورصة المصرية",
  description:
    "بيانات حية مؤجلة للبورصة المصرية: المؤشرات، ٢٩٦ شركة مقيدة بأسعار ومقاييس فعلية، أداء القطاعات، الخريطة الحرارية، أخبار السوق المصرية من مصادر عامة، ومتابعة محلية بلا تسجيل دخول.",
  applicationName: "EGX Desk",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EGX Desk",
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  icons: {
    icon: [
      // ?v= cache-buster: browsers pin favicons by URL — without it they
      // keep showing the old full-logo icon after the mark-only redesign.
      // favicon-32 + src/app/favicon.ico (auto-served at /favicon.ico) fix
      // the tab icon on browsers that specifically request the .ico file.
      { url: "/favicon-32.png?v=218", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png?v=218", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png?v=218", sizes: "512x512", type: "image/png" },
    ],
    shortcut: ["/favicon-32.png?v=218"],
    apple: [{ url: "/apple-touch-icon.png?v=218" }],
  },
};

/** T27 (P1-5) — the native-app viewport: viewport-fit=cover extends the
 *  canvas under notches/home bars (globals.css pads the header with
 *  env(safe-area-inset-top) in standalone mode), no user zooming fights
 *  the app feel, and the theme color matches the shell. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#2c2c2e" },
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
  ],
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${plexArabic.variable} ${plexMono.variable} ${plexSans.variable} ${lora.variable} ${amiri.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
