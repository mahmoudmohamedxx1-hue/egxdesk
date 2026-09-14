/** T26 — per-item news sentiment chips.
 *
 *  A transparent, deterministic, bilingual (Arabic + English) lexicon scorer
 *  for financial headlines — NOT an LLM, and labeled as such in the UI
 *  ("تحليل لغوي" / rule-based linguistic analysis). Each hit adds ±1 for
 *  bullish/bearish finance vocabulary in the title (double weight) and
 *  snippet; the sum maps to صعودي / هابط / محايد. Ticker attribution reuses
 *  the same word-boundary matching the company panel uses, against the live
 *  universe, so chips are clickable links into real company pages.
 *
 *  Why lexicon instead of the site's AI: news refreshes every few minutes
 *  and scoring must be free, instant, and rate-limit-proof — the honest
 *  trade is a visible "rule-based" label, not a fake "AI" claim. */

export type Sentiment = "bullish" | "bearish" | "neutral";

const EN_BULL = [
  "surge", "surges", "soar", "soars", "jump", "jumps", "rally", "rallies", "gain", "gains",
  "rise", "rises", "rose", "climb", "climbs", "record high", "all-time high", "upgrade",
  "upgraded", "beat", "beats", "outperform", "profit", "profits surge", "growth", "dividend",
  "buyback", "inflow", "inflows", "bullish", "rebound", "rebounds", "recover", "recovery",
  "expand", "expansion", "wins", "awarded", "contract win", "strong results", "top estimates",
];
const EN_BEAR = [
  "fall", "falls", "fell", "drop", "drops", "plunge", "plunges", "slump", "slumps", "decline",
  "declines", "loss", "losses", "downgrade", "downgraded", "miss", "misses", "warning",
  "warns", "probe", "investigation", "fine", "fined", "halt", "halted", "suspend", "suspended",
  "outflow", "outflows", "bearish", "sell-off", "selloff", "default", "bankruptcy", "cut",
  "cuts", "slash", "slashes", "weak results", "misses estimates", "layoff", "layoffs", "resign",
];
const AR_BULL = [
  "يرتفع", "ارتفاع", "صعود", "تصعد", "تزداد", "مكاسب", "مكسب", "أرباح قياسية", "أرباح مرتفعة",
  "نمو", "توزيعات", "تعافي", "تحسن", "توسع", "تفتح", "تدفق أجنبي", "تدفقات دخول", "إيجابي",
  "صعودي", "تربح", "تفوق", "توقعات أعلى", "ارتفاع قياسي", "شراء", "طفرة", "ازدهار", "ترتفع",
];
const AR_BEAR = [
  "يتراجع", "تراجع", "هبوط", "انخفاض", "تنخفض", "خسائر", "خسارة", "تحقيق", "تحذير", "غرامة",
  "عقوبة", "تجميد", "إيقاف", "توقف", "خروج أجنبي", "تدفقات خروج", "سلبية", "هبوطي", "بيع",
  "تخفيض", "خفض", "أزمة", "تعثر", "استقالة", "فضيحة", "تقلص", "تراجع حاد", "انكماش",
];

const EN_BULL_RE = new RegExp(`\\b(${EN_BULL.map(escapeRe).join("|")})\\b`, "gi");
const EN_BEAR_RE = new RegExp(`\\b(${EN_BEAR.map(escapeRe).join("|")})\\b`, "gi");
const AR_BULL_RE = new RegExp(`(${AR_BULL.map(escapeRe).join("|")})`, "g");
const AR_BEAR_RE = new RegExp(`(${AR_BEAR.map(escapeRe).join("|")})`, "g");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\-]/g, "\\$&");
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/** Score one headline (+snippet): > 0 bullish, < 0 bearish, 0 neutral.
 *  Title matches count double — headlines carry the news. */
export function scoreSentiment(title: string, snippet?: string | null): { sentiment: Sentiment; score: number } {
  const t = `${title}\n${snippet ?? ""}`.toLowerCase();
  const titleOnly = title.toLowerCase();
  let score = 0;
  score += 2 * countMatches(titleOnly, EN_BULL_RE) + countMatches(t, EN_BULL_RE);
  score -= 2 * countMatches(titleOnly, EN_BEAR_RE) + countMatches(t, EN_BEAR_RE);
  score += 2 * countMatches(titleOnly, AR_BULL_RE) + countMatches(t, AR_BULL_RE);
  score -= 2 * countMatches(titleOnly, AR_BEAR_RE) + countMatches(t, AR_BEAR_RE);
  const sentiment: Sentiment = score > 0 ? "bullish" : score < 0 ? "bearish" : "neutral";
  return { sentiment, score };
}

/** Tickers plausibly mentioned in a headline: English tickers + leading
 *  English name words against the live universe, plus Arabic brand aliases
 *  (Egyptian press usage — the same alias map the site-wide Arabic search
 *  uses) so Arabic headlines attribute companies too. */
export function tickersInText(
  text: string,
  universe: { ticker: string; name: string }[],
  arAliases?: Record<string, string[]>
): string[] {
  const out: string[] = [];
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/\u0640/g, "")
      .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
      .replace(/\u0629/g, "\u0647")
      .replace(/\u0649/g, "\u064A")
      .replace(/\s+/g, " ")
      .trim();
  const normText = norm(text);
  for (const s of universe) {
    const t = s.ticker.replace(/[^A-Z0-9]/gi, "");
    if (t.length >= 3 && new RegExp(`\\b${t}\\b`, "i").test(text)) {
      out.push(s.ticker);
      continue;
    }
    // English name words: require TWO distinctive words (or one long,
    // distinctive one) so "Delta Gate Mall" news does not light up
    // "Delta Sugar" — chips are attribution claims, precision first.
    const words = s.name
      .split(/[^A-Za-z]+/)
      .filter((w) => w.length > 4 && !["Egypt", "Egyptian", "Company", "Holding", "Limited", "Corporation", "General", "Middle"].includes(w))
      .slice(0, 3);
    if (words.length >= 2) {
      const matched = words.filter((w) => new RegExp(`\\b${w}\\b`, "i").test(text)).length;
      if (matched >= 2) {
        out.push(s.ticker);
        continue;
      }
    } else if (words.length === 1 && words[0].length >= 6 && new RegExp(`\\b${words[0]}\\b`, "i").test(text)) {
      out.push(s.ticker);
      continue;
    }
    if (arAliases) {
      const aliases = arAliases[s.ticker];
      if (aliases) {
        // Precision first: short brand words (قلعة، فوري، إعمار…) must match
        // as standalone tokens — "إعمار" inside "الإعمار" (reconstruction)
        // is NOT the company. Distinctive phrases (≥6 chars) match as
        // substrings.
        const tokens = normText.split(/[^؀-ۿa-z0-9]+/).filter(Boolean);
        const hit = aliases.some((a) => {
          const na = norm(a);
          if (!na) return false;
          return na.length >= 6 ? normText.includes(na) : tokens.includes(na);
        });
        if (hit) out.push(s.ticker);
      }
    }
  }
  return out.slice(0, 5);
}
