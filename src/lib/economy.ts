/** Server-side economy layer — REAL exchange rates and gold, from free public
 *  APIs reachable without a key (verified live):
 *    - FX:  open.er-api.com (daily refresh, EGP among ~160 currencies)
 *    - Gold: api.gold-api.com (XAU spot in USD, updated continuously)
 *  The Egyptian Central Bank (cbe.org.eg) blocks this network, so official
 *  rates are attributed honestly as "parallel-market reference" — we show the
 *  open market mid-rate and label it as such.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export type FxRate = {
  code: string;
  nameAr: string;
  nameEn: string;
  egpPer: number | null; // EGP per 1 unit
  usdPer: number | null; // USD per 1 unit (for context)
};

export type GoldQuote = {
  usdPerOunce: number | null;
  egpPerGram: number | null; // 24k, from USD spot × USD/EGP ÷ 31.1035
  egpPerGram21: number | null; // 21k — the Egyptian retail standard
  egpPerGram18: number | null; // 18k — jewelry alloy standard
  asOf: string | null;
};

export type EconomyData = {
  fx: FxRate[];
  gold: GoldQuote;
  fxUpdatedAt: string | null;
  sources: { name: string; url: string; role: string }[];
};

/** Currencies an Egyptian investor watches most. */
const FX_CURRENCIES: { code: string; nameAr: string; nameEn: string }[] = [
  { code: "USD", nameAr: "دولار أمريكي", nameEn: "US dollar" },
  { code: "EUR", nameAr: "يورو", nameEn: "Euro" },
  { code: "GBP", nameAr: "جنيه إسترليني", nameEn: "British pound" },
  { code: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi riyal" },
  { code: "AED", nameAr: "درهم إماراتي", nameEn: "UAE dirham" },
  { code: "CHF", nameAr: "فرنك سويسري", nameEn: "Swiss franc" },
  { code: "JPY", nameAr: "ين ياباني", nameEn: "Japanese yen" },
  { code: "CNY", nameAr: "يوان صيني", nameEn: "Chinese yuan" },
];

const GRAMS_PER_TROY_OUNCE = 31.1034768;

// ─────────────────────────────────────────────────────────── caching ───

type Entry = { data: unknown; at: number };
const cache = new Map<string, Entry>();
const stale = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const flying = inflight.get(key);
  if (flying) return flying as Promise<T>;
  const p = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, at: Date.now() });
      stale.set(key, { data, at: Date.now() });
      return data;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  try {
    return await p;
  } catch (err) {
    const s = stale.get(key);
    if (s) return s.data as T;
    throw err;
  }
}

type ErApi = { result?: string; time_last_update_utc?: string; rates?: Record<string, number> };
type GoldApi = { price?: number; updatedAt?: string };

export async function fetchEconomy(): Promise<EconomyData> {
  return cached("economy", 1800_000, async () => {
    const [fxRes, goldRes] = await Promise.allSettled([
      fetch("https://open.er-api.com/v6/latest/USD", {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch("https://api.gold-api.com/price/XAU", {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    let rates: Record<string, number> | null = null;
    let fxUpdatedAt: string | null = null;
    if (fxRes.status === "fulfilled" && fxRes.value.ok) {
      const j = (await fxRes.value.json()) as ErApi;
      if (j.result === "success" && j.rates?.EGP) {
        rates = j.rates;
        fxUpdatedAt = j.time_last_update_utc ?? null;
      }
    }

    let goldUsd: number | null = null;
    let goldAsOf: string | null = null;
    if (goldRes.status === "fulfilled" && goldRes.value.ok) {
      const j = (await goldRes.value.json()) as GoldApi;
      if (typeof j.price === "number" && Number.isFinite(j.price)) {
        goldUsd = j.price;
        goldAsOf = j.updatedAt ?? null;
      }
    }

    const egpPerUsd = rates?.EGP ?? null;

    const fx: FxRate[] = FX_CURRENCIES.map((c) => {
      const usdPer = rates?.[c.code] ?? null;
      // EGP per 1 unit = (EGP/USD) ÷ (unit/USD)
      const egpPer = usdPer && egpPerUsd ? egpPerUsd / usdPer : c.code === "USD" ? egpPerUsd : null;
      return { ...c, egpPer, usdPer };
    });

    const egpPerGram =
      goldUsd && egpPerUsd ? (goldUsd * egpPerUsd) / GRAMS_PER_TROY_OUNCE : null;

    const gold: GoldQuote = {
      usdPerOunce: goldUsd,
      egpPerGram,
      egpPerGram21: goldUsd && egpPerUsd ? (goldUsd * egpPerUsd * (21 / 24)) / GRAMS_PER_TROY_OUNCE : null,
      egpPerGram18: goldUsd && egpPerUsd ? (goldUsd * egpPerUsd * (18 / 24)) / GRAMS_PER_TROY_OUNCE : null,
      asOf: goldAsOf,
    };

    return {
      fx,
      gold,
      fxUpdatedAt,
      sources: [
        {
          name: "open.er-api.com — open-market FX mid-rates",
          url: "https://open.er-api.com/",
          role: "EGP exchange rates (daily open-market reference, not CBE official)",
        },
        {
          name: "gold-api.com — spot gold (XAU/USD)",
          url: "https://gold-api.com/",
          role: "International spot gold, converted to EGP per gram",
        },
      ],
    } satisfies EconomyData;
  });
}

// ─────────────────────────────────────────────── world markets & metals ───

export type WorldQuote = {
  key: string;
  symbol: string; // Yahoo symbol
  nameAr: string;
  nameEn: string;
  group: "index" | "commodity";
  price: number | null;
  changePct: number | null;
  currency: string;
  unitAr: string;
  unitEn: string;
  whyAr: string; // plain-Arabic one-liner: why an Egyptian investor watches it
  whyEn: string;
};

/** What the world priced overnight — the context local prices are read
 *  against. Live quotes from Yahoo Finance's public chart endpoint (the
 *  same feed our price history uses), each with a plain-language reason. */
const WORLD_WATCH: Omit<WorldQuote, "price" | "changePct">[] = [
  {
    key: "sp500", symbol: "^GSPC", group: "index", currency: "USD", unitAr: "نقطة", unitEn: "pts",
    nameAr: "ستاندرد آند بورز 500", nameEn: "S&P 500",
    whyAr: "أوسع مؤشر للشركات الأمريكية — مزاج المستثمر العالمي الذي تُوجّه تدفقاته إلى الأسواق الناشئة.",
    whyEn: "The broadest US corporate index — the global risk mood foreign flows into EGX follow.",
  },
  {
    key: "nasdaq", symbol: "^IXIC", group: "index", currency: "USD", unitAr: "نقطة", unitEn: "pts",
    nameAr: "ناسداك", nameEn: "Nasdaq Composite",
    whyAr: "مؤشر التكنولوجيا الأمريكية — يقود شهية المستثمرين لأسهم النمو مثل شركات التكنولوجيا المالية المصرية.",
    whyEn: "The US tech gauge — drives appetite for growth names like Egypt's fintech listings.",
  },
  {
    key: "ftse", symbol: "^FTSE", group: "index", currency: "GBP", unitAr: "نقطة", unitEn: "pts",
    nameAr: "فوتسي 100", nameEn: "FTSE 100",
    whyAr: "السوق البريطانية — من أكبر مستثمري الأسواق المصرية تاريخياً عبر الصناديق الأوروبية.",
    whyEn: "The UK market — one of the largest historical institutional investors in EGX.",
  },
  {
    key: "tasi", symbol: "^TASI.SR", group: "index", currency: "SAR", unitAr: "نقطة", unitEn: "pts",
    nameAr: "تاسي السعودي", nameEn: "TASI (Saudi)",
    whyAr: "السوق السعودية — منافس إقليمي على سيولة المستثمر العربي، وتاسي يرتفع حين تُسحب السيولة إليها.",
    whyEn: "The Saudi market — a regional competitor for Arab-investor liquidity in EGX.",
  },
  {
    key: "brent", symbol: "BZ=F", group: "commodity", currency: "USD", unitAr: "برميل", unitEn: "bbl",
    nameAr: "نفط برنت", nameEn: "Brent crude",
    whyAr: "أكبر مصدر نقد أجنبي لمصر بعد رسوم قناة السويس والسياحة — النفط الأعلى يعني دولارات أكثر للدولة.",
    whyEn: "One of Egypt's largest foreign-currency earners after canal dues and tourism.",
  },
  {
    key: "copper", symbol: "HG=F", group: "commodity", currency: "USD", unitAr: "رطل", unitEn: "lb",
    nameAr: "النحاس", nameEn: "Copper",
    whyAr: "معدن يقرأ صحة الصناعة العالمية — يدخل في كابلات ومصانع مصر ويحدد أسعارها.",
    whyEn: "The industrial-health metal — an input to Egypt's cable and manufacturing listings.",
  },
];

export type WorldMarkets = {
  quotes: WorldQuote[];
  silver: { usdPerOunce: number | null; egpPerGram: number | null };
  asOf: string | null;
};

type YahooChart = {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        currency?: string;
      };
    }[];
  };
};

async function yahooQuote(symbol: string): Promise<{ price: number | null; prev: number | null }> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }
    );
    if (!res.ok) return { price: null, prev: null };
    const j = (await res.json()) as YahooChart;
    const meta = j.chart?.result?.[0]?.meta;
    return {
      price: typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null,
      prev: typeof meta?.chartPreviousClose === "number" ? meta.chartPreviousClose : meta?.previousClose ?? null,
    };
  } catch {
    return { price: null, prev: null };
  }
}

/** World indices + commodities (Yahoo), silver (gold-api XAG), converted to
 *  EGP per gram where it is a metal. Cached 10 minutes. */
export async function fetchWorld(egpPerUsd: number | null): Promise<WorldMarkets> {
  return cached("world", 600_000, async () => {
    const [quotes, silverRes] = await Promise.all([
      Promise.all(
        WORLD_WATCH.map(async (w) => {
          const { price, prev } = await yahooQuote(w.symbol);
          const changePct = price !== null && prev && prev > 0 ? ((price - prev) / prev) * 100 : null;
          return { ...w, price, changePct };
        })
      ),
      fetch("https://api.gold-api.com/price/XAG", {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      }).catch(() => null),
    ]);

    let silverUsd: number | null = null;
    if (silverRes && silverRes.ok) {
      try {
        const j = (await silverRes.json()) as { price?: number };
        if (typeof j.price === "number") silverUsd = j.price;
      } catch {
        silverUsd = null;
      }
    }

    return {
      quotes,
      silver: {
        usdPerOunce: silverUsd,
        egpPerGram: silverUsd && egpPerUsd ? (silverUsd * egpPerUsd) / GRAMS_PER_TROY_OUNCE : null,
      },
      asOf: new Date().toISOString(),
    } satisfies WorldMarkets;
  });
}
