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
