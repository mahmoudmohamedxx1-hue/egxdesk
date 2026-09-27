"use client";

/** T60 → T64 — المزيد → الأبحاث (research): the methodology notes this app
 *  has actually published — every calculator's exact math, every index's
 *  exact weights — the way the source model's research screen carries its
 *  papers. What is not published yet is listed as not published, in so many
 *  words.
 *
 *  T64 additions: the flagship FAIR-VALUE paper (the five models with their
 *  equations, the CAPM inputs, the blend and its verdict bands), the
 *  valuation & debt map paper, the screener composite paper and the
 *  five-factor snowflake paper — plus a topic filter and a text search so
 *  the library is actually navigable. */

import { useMemo, useState } from "react";
import { useApp } from "../market/app-context";
import { NotebookPen, ChevronDown, ChevronUp, ExternalLink, Search } from "lucide-react";

type Topic = "valuation" | "screener" | "indices" | "ownership" | "testing" | "alerts";

type Paper = {
  id: string;
  topic: Topic;
  titleAr: string;
  titleEn: string;
  date: string;
  abstractAr: string;
  abstractEn: string;
  sections: { hAr: string; hEn: string; bodyAr: string; bodyEn: string }[];
  links?: { view: string; ticker?: string; panel?: string; ar: string; en: string }[];
};

const TOPICS: { id: Topic | "all"; ar: string; en: string }[] = [
  { id: "all", ar: "الكل", en: "All" },
  { id: "valuation", ar: "التقييم", en: "Valuation" },
  { id: "screener", ar: "الفرز", en: "Screener" },
  { id: "indices", ar: "المؤشرات", en: "Indices" },
  { id: "ownership", ar: "الملكية", en: "Ownership" },
  { id: "testing", ar: "الاختبار", en: "Testing" },
  { id: "alerts", ar: "التنبيهات", en: "Alerts" },
];

const PAPERS: Paper[] = [
  {
    id: "fair-value",
    topic: "valuation",
    titleAr: "منهجية القيمة العادلة: كيف تُحسب؟",
    titleEn: "Fair value methodology: how it is computed",
    date: "2026-09-26",
    abstractAr:
      "الورقة المرجعية لمحرك القيمة العادلة في التطبيق: خمسة نماذج كلاسيكية بمعادلاتها الكاملة، ومعدل خصم على CAPM مربوط بسعر الفائدة المصري، ونمو مستدام من أرباح الشركة نفسها، ومزج بأوزان معاد تسويتها مع نطاقات الحكم — كل رقم قابل لإعادة الإنتاج من الصفحة.",
    abstractEn:
      "The reference paper for the app's fair-value engine: five classic models with their full equations, a CAPM discount rate anchored to the Egyptian rate environment, sustainable growth from the company's own numbers, a renormalized blend with verdict bands — every number reproducible from the page.",
    sections: [
      {
        hAr: "المدخلات — من أين يأتي كل رقم",
        hEn: "The inputs — where every number comes from",
        bodyAr:
          "كل مدخل حقل منشور من ماسح TradingView لآخر اثني عشر شهرًا (TTM): ربح السهم EPS، ومضاعف القيمة الدفترية P/B، وعائد التوزيعات، ونسبة التوزيع، وعائد حقوق الملكية ROE، وبيتا. القيمة الدفترية للسهم مشتقة: BVPS = السعر ÷ P/B، وتوزيع السهم مشتق: DPS = عائد التوزيع% × السعر. وسيطات القطاع تُشتق من نفس لقطة السوق الحية، ولا تُستخدم إلا لقطاع فيه ٥ أسهم أو أكثر — وإلا يُستبدل وسيط السوق كله، ويُعلَن ذلك.",
        bodyEn:
          "Every input is a published TradingView scanner field (TTM): EPS, price/book, dividend yield, payout ratio, ROE, beta. Book value per share is derived: BVPS = price ÷ P/B, and dividend per share: DPS = yield% × price. Sector medians come from the same live universe snapshot and are only used when the sector holds 5+ names — otherwise the whole-market median substitutes, and the substitution is declared.",
      },
      {
        hAr: "النماذج الخمسة",
        hEn: "The five models",
        bodyAr:
          "١) مكرر القطاع × الربح: FV = EPS × وسيط P/E للقطاع (وزن ٢٥٪). ٢) مضاعف القطاع × الدفترية: FV = BVPS × وسيط P/B للقطاع (٢٠٪). ٣) رقم جراهام: FV = √(22.5 × EPS × BVPS) — أرضية الدفاع الكلاسيكية (١٥٪). ٤) نموذج جوردون للتوزيعات: F = DPS × (1+g) ÷ (r − g) (٢٠٪). ٥) المضاعف المبرر: FV = BVPS × (ROE − g) ÷ (r − g) — ما يسوّغه عائد الملكية من مضاعف دفترية (٢٠٪). عند غياب مدخلات نموذج يسقط النموذج نفسه بسببه المكتوب، وتُعاد تسوية الأوزان على المتاح، وتُنشر التغطية (كم من ٥ نماذج اشتغل).",
        bodyEn:
          "1) Peer P/E: FV = EPS × sector-median P/E (weight 25%). 2) Peer P/B: FV = BVPS × sector-median P/B (20%). 3) Graham number: FV = √(22.5 × EPS × BVPS) — the classic defensive floor (15%). 4) Gordon DDM: FV = DPS × (1+g) ÷ (r − g) (20%). 5) Justified P/B: FV = BVPS × (ROE − g) ÷ (r − g) — the multiple the ROE justifies (20%). When a model's inputs are missing the model drops out with its reason in words, the weights renormalize over the survivors, and the coverage (how many of 5 ran) ships with the result.",
      },
      {
        hAr: "معدل الخصم والنمو",
        hEn: "The discount rate and the growth",
        bodyAr:
          "معدل الخصم على CAPM: r = rf + β × علاوة المخاطر، حيث rf سعر سياسة البنك المركزي المصري المُجلب مباشرة من طبقة أسعار الفائدة في التطبيق (١٩٫٥٪ احتياطيًا عند تعذّر الجلب)، وعلاوة مخاطر الأسهم ٨٪ ثابتة ومعلنة، وبيتا من الماسح لكل سهم (احتياطي ١٫٠). النمو المستدام: g = ROE × (1 − نسبة التوزيع) بسقف ١٢٪، وإذا غاب الأساس يُستخدم نمو الإيرادات الربعي المقيد. ويُشترط أن يبقى الفارق r − g عند ٣ نقاط مئوية على الأقل، وإلا أسقط نموذجا التوزيعات والمضاعف المبرر بدل أن ينفجرا.",
        bodyEn:
          "The discount rate is CAPM: r = rf + β × ERP, with rf fetched live from the app's rates layer (the CBE policy rate; a declared 19.5% fallback when unreachable), the equity risk premium fixed and published at 8%, and beta from the scanner per stock (fallback 1.0). Sustainable growth: g = ROE × (1 − payout), capped at 12%; when the basis is missing the clamped quarterly revenue growth substitutes. The spread r − g must stay at 3 percentage points or more — otherwise the DDM and justified-P/B models drop out instead of exploding.",
      },
      {
        hAr: "بوابة العقلانية — كيف لا تسمّمنا التجزءات البيانات",
        hEn: "The sanity gates — how splits don't poison the data",
        bodyAr:
          "مكرر الماسح تحت ١ أو فوق ٥٠٠ (ومضاعف دفترية تحت ٠٫٠٥ أو فوق ١٠٠) يعامَل دائمًا كأثر تجزئة/استحقاق أو بيانات قديمة، وتُستبعد النماذج التي تتغذى عليه مع كتابة السبب — لا يُشترى سهم بمكرر ٠٫١ في الواقع. كما يُستبعد أي نموذج يسعّر السهم خارج نطاق ٠٫١×–١٠× من سعر سوقه كقيمة شاذة معلنة. هذه البوابات معروضة في مختبر النماذج نفسه: النموذج المستبعد يكتب سببه تحت اسمه.",
        bodyEn:
          "A scanner P/E under 1 or over 500 (and a P/B under 0.05 or over 100) is always treated as a split/rights artifact or stale data — the models that feed on it are excluded with the reason printed, because nobody actually buys a stock at a 0.1 multiple. Any model valuing the stock outside the 0.1×–10× band of its market price is likewise excluded as a declared outlier. The gates are visible in the model lab itself: an excluded model prints its reason under its name.",
      },
      {
        hAr: "المزج ونطاقات الحكم",
        hEn: "The blend and the verdict bands",
        bodyAr:
          "القيمة العادلة النهائية متوسط مرجّح بالنماذج المتاحة (الأوزان أعلاه تُعاد تسويتها). الفرق = (القيمة العادلة ÷ السعر − 1). الهامش = (القيمة العادلة − السعر) ÷ القيمة العادلة. الحكم: «رخيصة» عندما يبلغ الهامش هامش الأمان ١٥٪ أو أكثر؛ «أغلى» عند −١٠٪ أو أسوأ؛ وما بينهما «حول العادلة». شاشة «رخيصة مقابل قيمتها» ترتب بالفرق وتسمح بفلترة الخصم والتغطية.",
        bodyEn:
          "The final fair value is the weighted mean of the available models (the weights above, renormalized). Upside = (fair value ÷ price − 1). Margin = (fair value − price) ÷ fair value. The verdict: \"cheap\" when the margin reaches the 15% margin of safety; \"rich\" at −10% or worse; between them \"around fair value\". The cheap-vs-fair-value screen ranks by upside with discount and coverage filters.",
      },
      {
        hAr: "التحفظات — اقرأها قبل أي قرار",
        hEn: "The caveats — read before any decision",
        bodyAr:
          "بيئة الفائدة المصرية المرتفعة تضغط نماذج التوزيعات إلى الأسفل بقوة (عائد بديل آمن قريب من ٢٠٪ يجعل الجنيه الغالي مؤهلاً)، فلا تُفاجأ بخصم عميق منتظم في نموذج جوردون. مضاعفات القطاع نسبية — سوق قطاع كله مبالغ فيه يُظهر سهمه «عادلاً». رقم جراهام أرضية دفاعية لا هدف سعر. والمدخلات مؤجلة ~١٥ دقيقة ومحسوبة على TTM لا على مستقبل. كل الافتراضات قابلة للتحريك في مختبر النماذج لترى الحساسية بنفسك — والنتيجة ليست توصية.",
        bodyEn:
          "Egypt's high-rate environment presses the dividend models hard (a near-20% safe alternative makes equity expensive), so do not be surprised by a systematic deep discount in Gordon. Sector multiples are relative — an entire overpriced sector shows its members as \"fair\". The Graham number is a defensive floor, not a price target. Inputs are ~15-minute-delayed and computed on TTM, not the future. Every assumption is movable in the model lab so you can see the sensitivity yourself — and the output is not advice.",
      },
    ],
    links: [
      { view: "valuation", ar: "افتح الشاشة ↗", en: "open the screen ↗" },
      { view: "scenarios", ar: "حرّك الافتراضات في المختبر ↗", en: "move the assumptions in the lab ↗" },
    ],
  },
  {
    id: "valuation-map",
    topic: "valuation",
    titleAr: "منهجية خريطة التقييم والديون",
    titleEn: "Valuation & debt map methodology",
    date: "2026-09-26",
    abstractAr:
      "ثلاث قراءات على صفحة واحدة: خريطة المكرر ضد الرافعة بعدسة القيمة العادلة، وشاشة الأسهم الرخيصة مقابل قيمتها، وخريطة الديون على محورين — مع قواعد الشفافية في كل نقطة مرسومة.",
    abstractEn:
      "Three readings on one page: the P/E-vs-leverage map under the fair-value lens, the cheap-stocks screen, and the two-axis debt map — with the honesty rules printed on every plotted point.",
    sections: [
      {
        hAr: "خريطة التقييم والعدسة",
        hEn: "The map and the lens",
        bodyAr:
          "المحور الأفقي مكرر الربحية P/E والمحور الرأسي الدين ÷ حقوق الملكية D/E، ومساحة الفقاعة القيمة السوقية. الخطان المنقطان وسيطا السوق كله، والرباعيات الأربع وسيلة قراءة لا حكم. عدسة القيمة العادلة تلوّن كل فقاعة بفرقها عن قيمتها العادلة الممزوكة: أخضر عميق عند +٤٠٪ فأكثر، رمادي حول العادلة، أحمر عميق عند −٤٠٪ فأسوأ — نفس مقياس الألوان في كل مكان في القسم.",
        bodyEn:
          "The horizontal axis is P/E, the vertical is debt/equity, bubble area is market cap. The dashed lines are the whole market's medians; the four quadrants are a reading aid, not a verdict. The fair-value lens paints each bubble by its distance from the blended fair value: deep green at +40% or better, grey around fair, deep red at −40% or worse — the same color scale used everywhere in the section.",
      },
      {
        hAr: "المضاعف المعدّل بالدين وخريطة الديون",
        hEn: "The debt-adjusted multiple and the debt map",
        bodyAr:
          "المضاعف المعدّل = المكرر × (1 + D/E): ما تدفعه مقابل كل جنيه أرباح بعد تسعير الرافعة. خريطة الديون تحمل المحور الثاني: صافي الدين ÷ القيمة السوقية — عبء الدين مقابل ما تدفعه فعلًا، والنقاط تحت الصفر شركات نندها نقديًا. مناطق القراءة الخمس: صافي نقد، آمنة (D/E أقل من ٠٫٥)، متوسطة (٠٫٥–١)، مرتفعة (١–١٫٥)، ومرتفعة جدًا (فوق ١٫٥). الشركة بلا حقل منشور لا تُرسم — لا تُخترع نقطة لتعبئة قطاع.",
        bodyEn:
          "The debt-adjusted multiple = P/E × (1 + D/E): what you pay per pound of earnings once leverage is priced in. The debt map adds a second axis: net debt ÷ market cap — the debt burden against what you actually pay, with points below zero marking net-cash companies. The five reading zones: net cash, safe (D/E under 0.5), moderate (0.5–1), elevated (1–1.5), and high (above 1.5). A company without a published field is not plotted — no point is invented to fill a sector.",
      },
    ],
    links: [{ view: "valuation", ar: "افتح الخريطة ↗", en: "open the map ↗" }],
  },
  {
    id: "snowflake",
    topic: "valuation",
    titleAr: "منهجية لوحة خمس عوامل",
    titleEn: "Five-factor snowflake methodology",
    date: "2026-09-26",
    abstractAr:
      "النجمة الخماسية على صفحة كل شركة: القيمة والمستقبل والأداء والملاءة والتوزيعات — كل عامل من ٥ بمعادلة معلنة من أرقام الشركة نفسها مقابل وسيط قطاعها.",
    abstractEn:
      "The five-point star on every company page: value, future, past performance, health and dividends — each factor scored 0–5 by a published formula over the company's own numbers vs its sector median.",
    sections: [
      {
        hAr: "المعادلات",
        hEn: "The equations",
        bodyAr:
          "القيمة: (2 − المكرر÷وسيط القطاع) ÷ 1.5 × 5، ومثلها للمضاعف الدفتري، ثم المتوسط. المستقبل: نمو الإيرادات الربعي ÷ 5. الأداء: (ROE − 5) ÷ 5 ممزوجًا مع الهامش الصافي ÷ 4. الملاءة: (1.5 − D/E) ÷ 0.3 مع نقطة إضافية لصافي النقد. التوزيعات: العائد ÷ 2 مع نصف نقطة لنسبة توزيع بين ٣٠٪ و٧٠٪. كل حد مقيد ٠–٥، والغياب يُترك غيابًا.",
        bodyEn:
          "Value: (2 − P/E ÷ sector median) ÷ 1.5 × 5, same for P/B, then averaged. Future: quarterly revenue growth ÷ 5. Past: (ROE − 5) ÷ 5 blended with net margin ÷ 4. Health: (1.5 − D/E) ÷ 0.3 with a net-cash bonus point. Dividends: yield ÷ 2 with half a point for a 30–70% payout. Every score is clamped 0–5, and a missing input stays missing.",
      },
    ],
    links: [{ view: "company", ticker: "COMI", panel: "valuation", ar: "افتح لوحة شركة ↗", en: "open a company panel ↗" }],
  },
  {
    id: "screener",
    topic: "screener",
    titleAr: "منهجية الفرز المركّب (ثلاث ركائز)",
    titleEn: "Composite screener methodology (three pillars)",
    date: "2026-09-25",
    abstractAr:
      "مسح كل سهم متداول على ثلاث ركائز مستقلة: فني ٤٥٪، وأساسي ٣٠٪، وأخبار ٢٥٪ — بدرجة واحدة مرتبة وأوزان تُعاد تسويتها بصدق عند غياب ركيزة.",
    abstractEn:
      "A composite scan of every traded stock over three independent pillars: technical 45%, fundamental 30%, news 25% — one ranked score, with weights renormalized honestly whenever a pillar is missing.",
    sections: [
      {
        hAr: "الركيزة الأساسية",
        hEn: "The fundamental pillar",
        bodyAr:
          "التقييم (٤٠٪): log2(وسيط القطاع ÷ المكرر) بوزن ٠٫٦ ومثله للمضاعف الدفتري بوزن ٠٫٤ — النصف من وسيط القطاع = +١ والضعف = −١، والخسارة التشغيلية −٠٫٥ معلنة. الجودة (٣٥٪): ROE بوزن ٠٫٤٥ (٢٥٪ = +١)، الهامش الصافي ٠٫٣، والدين/الملكية ٠٫٢٥. الدخل (٢٥٪): عائد التوزيع بوزن ٠٫٧ (١٠٪ = +١) ونسبة التوزيع ٠٫٣ مع عقوبة لغير المستدام. الدرجة صفر عند تغطية أقل من مكونين — لا نصف درجة مشوشة.",
        bodyEn:
          "Valuation (40%): log2(sector median ÷ P/E) at weight .60 and the same shape on P/B at .40 — half the median scores +1, double scores −1, a loss-making TTM −0.5 with an explicit reason. Quality (35%): ROE at .45 (25% = +1), net margin at .30, debt/equity at .25. Income (25%): dividend yield at .70 (10% = +1) and payout at .30 with an unsustainability penalty. The score goes null under 2 components — no noisy half-score.",
      },
      {
        hAr: "المزج والغياب",
        hEn: "The blend and the gaps",
        bodyAr:
          "القاعدة ٤٥/٣٠/٢٥. عند غياب الأخبار تعود القاعدة إلى ٥٥/٤٥ (لا تتضخم الأخبار أبدًا فوق ٢٥٪ لأنها معجم قواعد على ١٤ يومًا صحفية — لاذع وتشويش أقل من السعر والقوائم). وعند غياب الأساسيات تذهب حصتها إلى الفني (٧٥/٢٥). التقييم وصف إحصائي لحركة السعر والقوائم المنشورة ونبرة الصحافة — ليس توصية.",
        bodyEn:
          "The base blend is 45/30/25. Missing news falls back to the 55/45 blend (news is never inflated above 25% — a rule-based lexicon over 14 days of press is real but noisier than price or reported financials). Missing fundamentals hand their share to the technical side (75/25). The rating describes price action, reported financials and press tone statistically — it is not advice.",
      },
    ],
    links: [{ view: "screener", ar: "افتح الفرز ↗", en: "open the screener ↗" }],
  },
  {
    id: "fear-greed",
    topic: "indices",
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
    links: [{ view: "home", ar: "افتح المؤشر ↗", en: "open the index ↗" }],
  },
  {
    id: "ownership",
    topic: "ownership",
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
    links: [{ view: "lens", ar: "افتح العدسة ↗", en: "open the lens ↗" }],
  },
  {
    id: "backtest",
    topic: "testing",
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
    links: [{ view: "scenarios", ar: "افتح المختبر ↗", en: "open the lab ↗" }],
  },
  {
    id: "crash",
    topic: "alerts",
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
    links: [{ view: "fragility", ar: "افتح البحث ↗", en: "open the research ↗" }],
  },
];

export function ResearchView() {
  const { lang, navigate } = useApp();
  const [open, setOpen] = useState<string | null>(PAPERS[0].id);
  const [topic, setTopic] = useState<Topic | "all">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return PAPERS.filter((p) => {
      if (topic !== "all" && p.topic !== topic) return false;
      if (!needle) return true;
      return (
        p.titleAr.includes(q.trim()) ||
        p.titleEn.toLowerCase().includes(needle) ||
        p.abstractAr.includes(q.trim()) ||
        p.abstractEn.toLowerCase().includes(needle) ||
        p.sections.some((s) => s.bodyAr.includes(q.trim()) || s.bodyEn.toLowerCase().includes(needle))
      );
    });
  }, [topic, q]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-5 w-5 text-primary" aria-hidden />
          <h1 className="text-lg font-bold">{lang === "ar" ? "الأبحاث" : "Research"}</h1>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {PAPERS.length} {lang === "ar" ? "ورقة" : "papers"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {lang === "ar"
            ? "أوراق المنهجية التي نشرها هذا التطبيق — معادلاتها كاملة على الطاولة."
            : "The methodology papers this app has published — their full math on the table."}
        </p>
      </div>

      {/* search + topic filter */}
      <div className="space-y-2">
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={lang === "ar" ? "ابحث في الأوراق…" : "search the papers…"}
            className="h-8 w-full rounded-lg border bg-background ps-8 pe-3 text-xs outline-none focus:ring-1 focus:ring-ring"
            aria-label={lang === "ar" ? "بحث" : "search"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {TOPICS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTopic(t.id)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                topic === t.id ? "border-foreground/20 bg-secondary font-semibold" : "border-transparent text-muted-foreground hover:bg-accent"
              }`}
            >
              {lang === "ar" ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {filtered.map((p) => {
          const isOpen = open === p.id;
          return (
            <article key={p.id} className="rounded-xl border bg-card p-3.5">
              <button onClick={() => setOpen(isOpen ? null : p.id)} className="flex w-full items-start justify-between gap-3 text-start">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold leading-snug">{lang === "ar" ? p.titleAr : p.titleEn}</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {p.date} ·{" "}
                    {lang === "ar" ? "ورقة منهجية · غير مراجَعة محكّليًا" : "methodology note · not peer-reviewed"} ·{" "}
                    {TOPICS.find((t) => t.id === p.topic)?.[lang === "ar" ? "ar" : "en"] ?? p.topic}
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
                    {(p.links ?? []).map((l) => (
                      <button
                        key={`${l.view}-${l.ticker ?? ""}`}
                        onClick={() => navigate(l.view, l.ticker ? { ticker: l.ticker, panel: l.panel } : undefined)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {lang === "ar" ? l.ar : l.en} <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
        {!filtered.length && (
          <p className="rounded-xl border bg-card p-4 text-center text-xs text-muted-foreground">
            {lang === "ar" ? "لا أوراق تحت هذا الفلتر." : "No papers under this filter."}
          </p>
        )}
      </div>

      <p className="rounded-xl border bg-card/60 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {lang === "ar"
          ? "ما لم يُنشر هنا بعد: أوراق مقيَّمة محكّليًا، ودراسات أحداث، ونماذج توقّع خارج المختبر. هذه القائمة تكبر عند نشر ورقة جديدة — ولن تُملأ بملخصات بلا معادلات."
          : "Not published here yet: peer-reviewed evaluations, event studies, and forecast models outside the lab. The list grows when a new note is published — it will never be padded with abstracts without equations."}
      </p>
    </div>
  );
}
