"use client";

/** T60 — المزيد → الأبحاث (research): the methodology notes this app has
 *  actually published — every calculator's exact math, every index's exact
 *  weights — the way the source model's research screen carries its papers.
 *  What is not published yet is listed as not published, in so many words. */

import { useState } from "react";
import { useApp } from "../market/app-context";
import { NotebookPen, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

type Paper = {
  id: string;
  titleAr: string;
  titleEn: string;
  date: string;
  abstractAr: string;
  abstractEn: string;
  sections: { hAr: string; hEn: string; bodyAr: string; bodyEn: string }[];
};

const PAPERS: Paper[] = [
  {
    id: "fear-greed",
    titleAr: "منهجية مؤشر الخوف والطمع",
    titleEn: "Fear & Greed methodology",
    date: "2026-09-21",
    abstractAr:
      "مؤشر مركّب من أربعة مكونات معلنة الأوزان يقرأ مزاج السوق المصري من بياناته هو — لا من استطلاعات ولا من مزاج كاتب المؤشر.",
    abstractEn:
      "A four-component composite with published weights that reads the Egyptian market's mood from its own data — not from surveys and not from the author's mood.",
    sections: [
      {
        hAr: "المعادلة",
        hEn: "The equation",
        bodyAr:
          "القيمة = ٠٫٣ × اتساع السوق + ٠٫٢٥ × زخم إيجي إكس ٣٠ لشهر + ٠٫٢٥ × موقع السعر من نطاق ٥٢ أسبوعًا + ٠٫٢ × صافي تدفقات الأجانب. عند غياب مكوّن تُعاد توزيع أوزانه على الباقي بالنسبة نفسها، ويُنشر كل مكوّن خام وقيمته المعيارية ٠–١٠٠ مع النتيجة — لا شيء يُحتسب في الظلام.",
        bodyEn:
          "Value = 0.30 × breadth + 0.25 × EGX30 one-month momentum + 0.25 × 52-week price position + 0.20 × foreign net flows. When a component is missing its weight is renormalized over the rest, and every raw component plus its 0–100 normalized score ships with the result — nothing is computed in the dark.",
      },
      {
        hAr: "القراءة",
        hEn: "The reading",
        bodyAr:
          "٠–٢٤ خوف شديد · ٢٥–٤٤ خوف · ٤٥–٥٥ محايد · ٥٦–٧٥ طمع · ٧٦–١٠٠ طمع شديد. المؤشر وصفٌ لما حدث، وليس توقعًا لما سيحدث.",
        bodyEn:
          "0–24 extreme fear · 25–44 fear · 45–55 neutral · 56–75 greed · 76–100 extreme greed. The index describes what happened, not what will.",
      },
    ],
  },
  {
    id: "ownership",
    titleAr: "منهجية عدسة الملكية",
    titleEn: "Ownership Lens methodology",
    date: "2026-09-22",
    abstractAr:
      "كل حصة مرسومة على الخريطة مأخوذة من إفصاح رسمي مودع للبورصة، مع رابط النشرة الأصلية — والنسب ملك لشركة واحدة ولا تُجمع أبدًا.",
    abstractEn:
      "Every stake drawn on the map comes from an official disclosure filed with the exchange, with a link to the original bulletin — and percentages belong to one company, never summed.",
    sections: [
      {
        hAr: "القاعدة الأولى: غير المفصح ≠ الأسهم الحرة",
        hEn: "Rule one: undisclosed ≠ free float",
        bodyAr:
          "الجزء الرمادي في كل حلقة هو ملكية لم يُلزم أحد بالإفصاح عنها — ليست أسهمًا حرة بالضرورة، وقد يملكها مالك استراتيجي واحد لم يُفصح. الرسم يقول ما قاله الإفصاح، لا أكثر.",
        bodyEn:
          "The grey part of every ring is ownership nobody had to disclose — not necessarily free float, and possibly one strategic holder who was not required to file. The drawing says what the filings said, nothing more.",
      },
      {
        hAr: "الأدلة",
        hEn: "The evidence chain",
        bodyAr:
          "كل موضع ملكية يحمل سند الإفصاح: نموذج ما بعد التنفيذ للصفحات الداخلية، ونماذج هيكل الملكية ومجالس الإدارة للقوائم الدائمة — برابط النشرة الرسمي على كل صف في اللوحة الجانبية.",
        bodyEn:
          "Every position carries its filing basis: post-execution forms for insider dealings, and board/shareholder-structure forms for the standing register — each row in the side panel links to the official bulletin.",
      },
    ],
  },
  {
    id: "backtest",
    titleAr: "منهجية مختبر النماذج",
    titleEn: "Model Lab methodology",
    date: "2026-09-22",
    abstractAr:
      "كيف يُختبر نظام الإشارات: نوافذ إعادة تشغيل مؤرخة، تثبيت التاريخ قبل النتيجة، واستثناء الصفقات المشبوهة، ونشر الخاسر مع الرابح.",
    abstractEn:
      "How the signal system is tested: dated replay windows, freezing the record before the outcome exists, excluding suspect prints, and publishing the losers with the winners.",
    sections: [
      {
        hAr: "قاعدة تثبيت السجل",
        hEn: "The frozen-record rule",
        bodyAr:
          "كل نافذة تُقيَّم على الجلسات التي تلي تاريخها فقط، والصفقات ذات العائد غير المعتاد داخل فترة احتفاظ قصيرة تُستثنى كأخطار تجزئة محتملة (وتُعلَم — لم تُستثنَ أي صفقة في آخر تشغيل).",
        bodyEn:
          "Every window is evaluated only on the sessions after its date, and trades with abnormal returns inside a short hold are excluded as likely split/rights prints (and flagged — none were excluded in the last run).",
      },
    ],
  },
  {
    id: "crash",
    titleAr: "منهجية إنذار الانهيارات",
    titleEn: "Crash-warning methodology",
    date: "2026-09-24",
    abstractAr:
      "قاعدة واحدة معلنة بالكامل، على مؤشر مرجعي مركّب معلن العضوية، بعائد أذون يمكن للقارئ تحريكه — وكل تحفظات التحيّز مكتوبة على الصفحة نفسها.",
    abstractEn:
      "One fully declared rule, on a declared-membership reference composite, with a reader-movable T-bill yield — and every bias caveat written on the same page.",
    sections: [
      {
        hAr: "التحفظات",
        hEn: "The caveats",
        bodyAr:
          "العضوية من قائمة اليوم (تحيّز البقاء)، والتنفيذ عند إغلاق اليوم التالي تقريبًا لافتتاح الجلسة، وعائد الأذون مفترض ثابتًا. الأخطر: القاعدة مضبوطة على تاريخ واحد — المرة القادمة قد تكون مختلفة، وهذا ما يعنيه «اختبار على أسعار سابقة».",
        bodyEn:
          "Membership is today's list (survivorship), execution approximates next-session open at that day's close, and the T-bill yield is an assumption. Most importantly: the rule is fitted to one history — next time may differ, and that is exactly what \"a backtest on past prices\" means.",
      },
    ],
  },
];

export function ResearchView() {
  const { lang, navigate } = useApp();
  const [open, setOpen] = useState<string | null>(PAPERS[0].id);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "الأبحاث" : "Research"}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "أوراق المنهجية التي نشرها هذا التطبيق — معادلاتها كاملة على الطاولة."
            : "The methodology papers this app has published — their full math on the table."}
        </p>
      </div>

      <div className="space-y-2.5">
        {PAPERS.map((p) => {
          const isOpen = open === p.id;
          return (
            <article key={p.id} className="rounded-xl border bg-card p-3.5">
              <button onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-start justify-between gap-3 text-start">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-snug">{lang === "ar" ? p.titleAr : p.titleEn}</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {p.date} ·{" "}
                    {lang === "ar" ? "ورقة منهجية · غير مراجَعة محكّليًا" : "methodology note · not peer-reviewed"}
                  </p>
                </div>
                {isOpen ? (
                  <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </button>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{lang === "ar" ? p.abstractAr : p.abstractEn}</p>
              {isOpen && (
                <div className="mt-2.5 space-y-2.5">
                  {p.sections.map((s, i) => (
                    <div key={i} className="rounded-lg bg-secondary/50 p-2.5">
                      <h3 className="text-xs font-bold">{lang === "ar" ? s.hAr : s.hEn}</h3>
                      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{lang === "ar" ? s.bodyAr : s.bodyEn}</p>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2 text-[11px]">
                    {p.id === "fear-greed" && (
                      <button onClick={() => navigate("home")} className="inline-flex items-center gap-1 text-primary hover:underline">
                        {lang === "ar" ? "افتح المؤشر ↗" : "open the index ↗"} <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                    {p.id === "ownership" && (
                      <button onClick={() => navigate("lens")} className="inline-flex items-center gap-1 text-primary hover:underline">
                        {lang === "ar" ? "افتح العدسة ↗" : "open the lens ↗"} <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                    {p.id === "backtest" && (
                      <button onClick={() => navigate("scenarios")} className="inline-flex items-center gap-1 text-primary hover:underline">
                        {lang === "ar" ? "افتح المختبر ↗" : "open the lab ↗"} <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                    {p.id === "crash" && (
                      <button onClick={() => navigate("fragility")} className="inline-flex items-center gap-1 text-primary hover:underline">
                        {lang === "ar" ? "افتح البحث ↗" : "open the research ↗"} <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <p className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {lang === "ar"
          ? "ما لم يُنشر هنا بعد: أوراق مقيَّمة محكّليًا، ودراسات أحداث، ونماذج توقّع. هذه القائمة تكبر عند نشر ورقة جديدة — ولن تُملأ بملخصات بلا معادلات."
          : "Not published here yet: peer-reviewed evaluations, event studies, and forecast models. The list grows when a new note is published — it will never be padded with abstracts without equations."}
      </p>
    </div>
  );
}
