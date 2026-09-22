/** T58 — deterministic BRIEFING COMPOSER + language gate.
 *
 *  The live keyless tier (LLM7 anonymous → mistral-Nemo) sometimes answers an
 *  ARABIC question in Portuguese/Spanish/French with exotic-script fragments —
 *  "crash text". The T38 gate verifies NUMBERS, but nothing verified the
 *  LANGUAGE. This module gives both routes (agent + assistant) the missing
 *  two layers:
 *
 *   1. languageOk(text, lang)  — is this answer actually in the requested
 *      language? (Arabic letters must dominate for ar; exotic scripts fail
 *      both languages; Latin tickers/abbreviations are always allowed.)
 *   2. composeBriefing(lang, toolResults) — a deterministic markdown answer
 *      built ONLY from real tool output shapes (market_overview, quote(s),
 *      top_movers, screen, technicals, signals…). Never a wrong language,
 *      never an invented number: every figure is copied from the tool JSON,
 *      and the template is honest about being machine-composed.
 *
 *  Pure functions, no imports — safe for both the server routes and unit
 *  checks. Number formatting: en-GB digits, thousands separators, ٪ vs %.
 */

const AR_LETTER = /[\u0621-\u064A]/g; // Arabic letters (no diacritics)
const EN_LETTER = /[A-Za-z]/g;
// scripts that have NO business inside an Arabic or English market answer
const EXOTIC = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0E00-\u0E7F\u0E80-\u0EFF\uAC00-\uD7AF\u1100-\u11FF\u3040-\u30FF\u31F0-\u31FF\u4E00-\u9FFF\u3400-\u4DBF\u0400-\u04FF\u0500-\u052F\u0370-\u03FF]/;

// English function words — real English prose of any length contains several.
// The live keyless failure answered an English question in PORTUGUESE, which
// is Latin script and therefore invisible to a script-ratio check alone.
const EN_STOP = /\b(the|is|are|was|were|with|and|of|to|in|on|at|for|from|by|as|that|this|it|its|be|been|has|have|had|not|but|or|will|would|can|could|than|then|such|into|over|after|before|per|via|led)\b/gi;

/** Is the text in the requested language? Ratio threshold is lenient: Latin
 *  tickers (COMI, EGX30) and finance abbreviations (P/E, RSI) legitimately
 *  ride inside Arabic prose, but a whole Romance-language paragraph does not. */
export function languageOk(text: string, lang: "ar" | "en"): boolean {
  if (!text || text.trim().length < 20) return false; // too thin to judge
  if (EXOTIC.test(text)) return false; // Telugu/Cyrillic/CJK/… = defect, always
  const ar = (text.match(AR_LETTER) || []).length;
  const en = (text.match(EN_LETTER) || []).length;
  if (ar + en < 15) return false; // numbers-only table fragments: judge as fail-safe
  if (lang === "ar") return ar / (ar + en) >= 0.45;
  if (en / (ar + en) < 0.45) return false; // answered Arabic when English was asked
  // Latin-dominant, but is it ENGLISH? Long Latin text with zero English
  // function words is Portuguese/Spanish/French soup → reject.
  const words = (text.match(/[A-Za-z]+/g) || []).length;
  if (words >= 25 && (text.match(EN_STOP) || []).length === 0) return false;
  return true;
}

// ── number formatting helpers ──────────────────────────────────────────────

const nf = (v: number, d = 2): string =>
  Number.isFinite(v) ? v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

const pct = (v: number | null | undefined, d = 2): string =>
  typeof v === "number" && Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(d)}${"%"}` : "—";

function egpCompact(v: number | null | undefined, lang: "ar" | "en"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const mn = Math.abs(v);
  const body =
    mn >= 1e9 ? `${(mn / 1e9).toFixed(2)}B` : mn >= 1e6 ? `${(mn / 1e6).toFixed(1)}M` : mn >= 1e3 ? `${(mn / 1e3).toFixed(0)}K` : mn.toFixed(0);
  return lang === "ar" ? `${v < 0 ? "−" : ""}${body.replace("B", " مليار").replace("M", " مليون").replace("K", " ألف")} جنيه` : `${v < 0 ? "-" : ""}EGP ${body}`;
}

/** Flows arrive in EGP MILLIONS (flowsSummary contract) — spell the unit out. */
function egpMnValue(v: number | null | undefined, lang: "ar" | "en"): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const mn = Math.abs(v);
  const body = mn >= 1000 ? `${(mn / 1000).toFixed(2)}B` : `${mn.toFixed(0)}M`;
  return lang === "ar" ? `${v < 0 ? "−" : ""}${body.replace("B", " مليار").replace("M", " مليون")} جنيه` : `${v < 0 ? "-" : ""}EGP ${body}`;
}

const dirAr = (v: number): string => (v > 0 ? "صاعد" : v < 0 ? "هابط" : "ثابت");
const dirEn = (v: number): string => (v > 0 ? "up" : v < 0 ? "down" : "flat");

/** Company display name for the requested language — null when the row only
 *  carries a name in the OTHER language (an English briefing must not carry
 *  Arabic company names, and vice versa; the ticker alone is always safe). */
function nameFor(row: Row, lang: "ar" | "en"): string | null {
  if (lang === "ar") {
    const n = str(row.nameAr) || str(row.name);
    return /[\u0621-\u064A]/.test(n) ? n : null;
  }
  const n = str(row.name) || str(row.nameEn);
  return n && /[A-Za-z]/.test(n) && !/[\u0600-\u06FF]/.test(n) ? n : null;
}

// ── the shapes we recognize (agent tool output contracts) ──────────────────

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const has = (o: Row, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

function isMarketOverview(r: unknown): r is Row {
  return !!r && typeof r === "object" && has(r as Row, "indices") && has(r as Row, "breadth");
}
function isQuote(r: unknown): r is Row {
  return !!r && typeof r === "object" && has(r as Row, "ticker") && has(r as Row, "close");
}
function isMoversList(r: unknown): r is Row[] {
  return Array.isArray(r) && r.length > 0 && r.every((x) => isQuote(x));
}
function isScreen(r: unknown): r is Row {
  return !!r && typeof r === "object" && has(r as Row, "metric") && Array.isArray((r as Row).rows);
}
function isTechnicals(r: unknown): r is Row {
  return !!r && typeof r === "object" && has(r as Row, "rsi") && has(r as Row, "macdHist");
}
function isSignals(r: unknown): r is Row[] {
  return Array.isArray(r) && r.length > 0 && r.every((x) => !!x && typeof x === "object" && has(x as Row, "composite"));
}

// ── section builders (each returns "" when its data is absent) ─────────────

function marketOverviewSection(r: Row, lang: "ar" | "en"): string {
  const L: string[] = [];
  const idx = Array.isArray(r.indices) ? (r.indices as Row[]) : [];
  const br = (r.breadth ?? {}) as Row;
  const movers = Array.isArray(r.movers) ? (r.movers as Row[]) : [];
  const flows = (r.flows ?? null) as Row | null;
  const best = (r.bestSector ?? null) as Row | null;
  const worst = (r.worstSector ?? null) as Row | null;
  // the tool's narrative is composed in ARABIC (agent-core hard-codes ar) —
  // reuse it only for Arabic answers; English gets its own deterministic line
  const narrAr = typeof r.narrative === "string" ? r.narrative.trim() : "";
  const narrIsLatin = narrAr && !languageOk(narrAr, "ar") && /[A-Za-z]/.test(narrAr);
  if (lang === "ar" && narrAr) {
    L.push(`**الخلاصة:** ${narrAr}`);
  } else {
    const egx30 = idx.find((i) => str(i.code) === "EGX30");
    const ch = num(egx30?.changePct) ?? 0;
    L.push(
      lang === "ar"
        ? `**الخلاصة:** EGX30 ${dirAr(ch)} ${pct(ch)} عند ${nf(num(egx30?.close) ?? 0, 1)} نقطة.`
        : `**Summary:** EGX30 is ${dirEn(ch)} ${pct(ch)} at ${nf(num(egx30?.close) ?? 0, 1)}${narrIsLatin ? `. ${narrAr}` : ""}`
    );
  }
  if (idx.length) {
    const rows = idx
      .map((i) => `| ${str(i.code)} | ${nf(num(i.close) ?? 0, 1)} | ${pct(num(i.changePct))} |`)
      .join("\n");
    L.push(
      (lang === "ar" ? "### المؤشرات\n| المؤشر | الإغلاق | التغير |\n|---|---|---|\n" : "### Indices\n| Index | Close | Change |\n|---|---|---|\n") + rows
    );
  }
  if (num(br.total) && num(br.up) !== null) {
    L.push(
      lang === "ar"
        ? `- ${lang === "ar" ? "الاتساع" : "Breadth"}: ${num(br.up)} ${lang === "ar" ? "صاعد" : "up"} / ${num(br.down)} ${lang === "ar" ? "هابط" : "down"} / ${num(br.flat)} ${lang === "ar" ? "ثابت" : "flat"} ${lang === "ar" ? "من" : "of"} ${num(br.total)} ${lang === "ar" ? "سهم" : "stocks"}`
        : `- Breadth: ${num(br.up)} up / ${num(br.down)} down / ${num(br.flat)} flat of ${num(br.total)} stocks`
    );
  }
  if (flows && num(flows.egyNet) !== null) {
    L.push(
      lang === "ar"
        ? `- التدفقات (صافي): المصريون ${egpMnValue(num(flows.egyNet), "ar")} · العرب ${egpMnValue(num(flows.arabNet), "ar")} · الأجانب ${egpMnValue(num(flows.forNet), "ar")}`
        : `- Net flows: Egyptians ${egpMnValue(num(flows.egyNet), "en")} · Arabs ${egpMnValue(num(flows.arabNet), "en")} · Foreigners ${egpMnValue(num(flows.forNet), "en")}`
    );
  }
  if (best && worst && str(best.nameAr)) {
    // EN answers use the English sector name only (never an Arabic fallback)
    const bEn = str(best.nameEn);
    const wEn = str(worst.nameEn);
    if (lang === "ar") {
      L.push(`- قطاعياً: ${str(best.nameAr)} ${pct(num(best.changePct))} في الصدارة · ${str(worst.nameAr)} ${pct(num(worst.changePct))} في المؤخرة`);
    } else if (bEn && wEn) {
      L.push(`- By sector: ${bEn} ${pct(num(best.changePct))} leads · ${wEn} ${pct(num(worst.changePct))} lags`);
    }
  }
  if (movers.length) {
    // company column only when names exist in the ANSWER's language
    const named = movers.some((m) => nameFor(m, lang));
    const rows = movers
      .slice(0, 5)
      .map((m) => (named ? `| ${str(m.ticker)} | ${nameFor(m, lang) ?? ""} | ${pct(num(m.changePct))} |` : `| ${str(m.ticker)} | ${pct(num(m.changePct))} |`))
      .join("\n");
    const head = named
      ? lang === "ar"
        ? "### أبرز الحركات\n| السهم | الشركة | التغير |\n|---|---|---|\n"
        : "### Top movers\n| Ticker | Company | Change |\n|---|---|---|\n"
      : lang === "ar"
        ? "### أبرز الحركات\n| السهم | التغير |\n|---|---|\n"
        : "### Top movers\n| Ticker | Change |\n|---|---|\n";
    L.push(head + rows);
  }
  return L.join("\n\n");
}

function quoteSection(q: Row, lang: "ar" | "en"): string {
  const L: string[] = [];
  const name = lang === "ar" ? str(q.nameAr) || str(q.ticker) : str(q.name) || str(q.ticker);
  L.push(
    lang === "ar"
      ? `### ${str(q.ticker)} — ${name}`
      : `### ${str(q.ticker)} — ${name}`
  );
  L.push(
    lang === "ar"
      ? `- ${lang === "ar" ? "السعر" : "Price"}: ${nf(num(q.close) ?? 0)} EGP (${pct(num(q.changePct))}, ${num(q.changeAbs) !== null ? (num(q.changeAbs) as number).toFixed(2) : "—"} EGP)`
      : `- Price: ${nf(num(q.close) ?? 0)} EGP (${pct(num(q.changePct))}, ${num(q.changeAbs) !== null ? (num(q.changeAbs) as number).toFixed(2) : "—"} EGP)`
  );
  const facts: string[] = [];
  if (num(q.marketCap) !== null) facts.push(`${lang === "ar" ? "القيمة السوقية" : "Market cap"} ${egpCompact(num(q.marketCap), lang)}`);
  if (num(q.pe) !== null) facts.push(`P/E ${nf(num(q.pe) as number, 1)}`);
  if (num(q.pb) !== null) facts.push(`P/B ${nf(num(q.pb) as number, 1)}`);
  if (num(q.divYield) !== null) facts.push(`${lang === "ar" ? "عائد التوزيع" : "Div yield"} ${nf(num(q.divYield) as number, 1)}%`);
  if (num(q.perfYTD) !== null) facts.push(`${lang === "ar" ? "من بداية العام" : "YTD"} ${pct(num(q.perfYTD), 1)}`);
  if (num(q.perf1M) !== null) facts.push(`1M ${pct(num(q.perf1M), 1)}`);
  if (num(q.perfY) !== null) facts.push(`1Y ${pct(num(q.perfY), 1)}`);
  if (facts.length) L.push(`- ${facts.join(" · ")}`);
  const hi = num(q.high52);
  const lo = num(q.low52);
  if (hi !== null && lo !== null) {
    L.push(`- 52w: ${nf(lo, 1)} — ${nf(hi, 1)} EGP`);
  }
  return L.join("\n");
}

function moversSection(list: Row[], lang: "ar" | "en"): string {
  const rows = list
    .slice(0, 10)
    .map((m) => `| ${str(m.ticker)} | ${nf(num(m.close) ?? 0)} | ${pct(num(m.changePct))} | ${num(m.valueTradedEgpMn) !== null ? `${num(m.valueTradedEgpMn)}M` : "—"} |`)
    .join("\n");
  return (
    (lang === "ar"
      ? "### القائمة\n| السهم | الإغلاق | التغير | قيمة التداول |\n|---|---|---|---|\n"
      : "### List\n| Ticker | Close | Change | Value |\n|---|---|---|---|\n") + rows
  );
}

function screenSection(r: Row, lang: "ar" | "en"): string {
  const rows = Array.isArray(r.rows) ? (r.rows as Row[]) : [];
  const metric = str(r.metric) || "marketCap";
  const named = rows.some((x) => nameFor(x, lang));
  const body = rows
    .slice(0, 10)
    .map((x) =>
      named
        ? `| ${str(x.ticker)} | ${nameFor(x, lang) ?? ""} | ${num(x[metric]) !== null ? String(num(x[metric])) : "—"} | ${pct(num(x.changePct), 1)} |`
        : `| ${str(x.ticker)} | ${num(x[metric]) !== null ? String(num(x[metric])) : "—"} | ${pct(num(x.changePct), 1)} |`
    )
    .join("\n");
  const head = named
    ? lang === "ar"
      ? `### النتائج (${str(r.direction) === "bottom" ? "الأدنى" : "الأعلى"} ${metric})\n| السهم | الشركة | ${metric} | التغير |\n|---|---|---|---|\n`
      : `### Results (${str(r.direction) === "bottom" ? "bottom" : "top"} ${metric})\n| Ticker | Company | ${metric} | Change |\n|---|---|---|---|\n`
    : lang === "ar"
      ? `### النتائج (${str(r.direction) === "bottom" ? "الأدنى" : "الأعلى"} ${metric})\n| السهم | ${metric} | التغير |\n|---|---|---|\n`
      : `### Results (${str(r.direction) === "bottom" ? "bottom" : "top"} ${metric})\n| Ticker | ${metric} | Change |\n|---|---|---|\n`;
  return head + body;
}

function technicalsSection(r: Row, lang: "ar" | "en"): string {
  const L: string[] = [];
  const rsi = num(r.rsi);
  const macd = num(r.macdHist);
  const pos52 = num(r.pos52);
  L.push(lang === "ar" ? `### ${str(r.ticker)} — المؤشرات الفنية` : `### ${str(r.ticker)} — technicals`);
  if (rsi !== null)
    L.push(
      lang === "ar"
        ? `- RSI(14): ${nf(rsi, 1)} — ${rsi > 70 ? "تشبع شرائي" : rsi < 30 ? "تشبع بيعي" : "منطقة محايدة"}`
        : `- RSI(14): ${nf(rsi, 1)} — ${rsi > 70 ? "overbought" : rsi < 30 ? "oversold" : "neutral"}`
    );
  if (macd !== null) L.push(`- MACD histogram: ${nf(macd, 3)}`);
  if (pos52 !== null)
    L.push(
      lang === "ar"
        ? `- الموضع من مدى 52 أسبوعًا: ${(pos52 * 100).toFixed(0)}٪`
        : `- 52-week position: ${(pos52 * 100).toFixed(0)}%`
    );
  return L.join("\n");
}

function signalsSection(list: Row[], lang: "ar" | "en"): string {
  const named = list.some((s) => nameFor(s, lang));
  const rows = list
    .slice(0, 8)
    .map((s) =>
      named
        ? `| ${str(s.ticker)} | ${nameFor(s, lang) ?? ""} | ${str(s.compositeRating) || str(s.rating) || "—"} | ${pct(num(s.changePct), 1)} |`
        : `| ${str(s.ticker)} | ${str(s.compositeRating) || str(s.rating) || "—"} | ${pct(num(s.changePct), 1)} |`
    )
    .join("\n");
  const head = named
    ? lang === "ar"
      ? "### الإشارات\n| السهم | الشركة | التقييم | التغير |\n|---|---|---|---|\n"
      : "### Signals\n| Ticker | Company | Rating | Change |\n|---|---|---|---|\n"
    : lang === "ar"
      ? "### الإشارات\n| السهم | التقييم | التغير |\n|---|---|---|\n"
      : "### Signals\n| Ticker | Rating | Change |\n|---|---|---|\n";
  return head + rows;
}

// ── the composer ───────────────────────────────────────────────────────────

export type ToolResultRef = { tool: string; result: unknown };

/** Deterministic markdown briefing from collected tool results. Returns null
 *  when nothing recognizable is on the table (caller falls back to its own
 *  honest message). Every number is copied verbatim from the tool JSON. */
export function composeBriefing(lang: "ar" | "en", toolResults: ToolResultRef[]): string | null {
  const sections: string[] = [];
  for (const { tool, result } of toolResults) {
    if (result && typeof result === "object" && !Array.isArray(result) && "error" in (result as Row)) continue; // failed tool
    // compare/quotes return ARRAYS of full quote rows — render each as its own
    // quote section, not the generic movers table
    if ((tool === "compare" || tool === "quotes" || tool === "quote") && isMoversList(result)) {
      for (const q of result) {
        const s = quoteSection(q, lang);
        if (s) sections.push(s);
      }
      continue;
    }
    if (isMarketOverview(result)) {
      const s = marketOverviewSection(result, lang);
      if (s) sections.push(s);
    } else if (isScreen(result)) {
      const s = screenSection(result, lang);
      if (s) sections.push(s);
    } else if (isMoversList(result)) {
      const s = moversSection(result, lang);
      if (s) sections.push(s);
    } else if (isSignals(result)) {
      const s = signalsSection(result, lang);
      if (s) sections.push(s);
    } else if (isTechnicals(result)) {
      const s = technicalsSection(result, lang);
      if (s) sections.push(s);
    } else if (isQuote(result)) {
      const s = quoteSection(result, lang);
      if (s) sections.push(s);
    }
  }
  if (!sections.length) return null;
  const note =
    lang === "ar"
      ? "_ملخّص مولَّد آليًا من بيانات الأدوات المباشرة (تعذّر تشكيل الرد عبر النموذج المجاني)._"
      : "_Auto-generated briefing from live tool data (the free model could not compose the reply)._";
  return `${note}\n\n${sections.join("\n\n")}`;
}

/** The repair message pushed back to the model when the LANGUAGE is wrong
 *  (numbers were already verified at this point — only the language isn't). */
export function languageRepairMessage(lang: "ar" | "en"): string {
  return lang === "ar"
    ? "اللغة خاطئة: الإجابة السابقة ليست بالعربية. أعد كتابة الإجابة النهائية بالعربية الفصحى المبسطة فقط — لا برتغالية ولا إسبانية ولا فرنسية ولا أي لغة أخرى. انسق كل الأرقام كما هي دون تغيير، وحافظ على البنية والجداول. ردّ الآن بصيغة {\"final\": \"<markdown>\"}."
    : "Wrong language: the previous answer was not in English. Rewrite the final answer in clear English only — no other language. Keep every number exactly as it is, keep the structure and tables. Reply NOW in the format {\"final\": \"<markdown>\"}.";
}
