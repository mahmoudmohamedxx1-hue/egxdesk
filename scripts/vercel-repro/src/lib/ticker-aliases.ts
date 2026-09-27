/** EGX ticker aliases — the exchange's own Reuters codes for instruments
 *  TradingView still serves under ISIN-like symbols.
 *
 *  Live QA (T38) found 8 of 296 instruments whose `ticker` in the scanner
 *  feed is the raw ISIN-shaped code (EGS370O1C013…) instead of the short
 *  Reuters ticker users actually read (NAPR…). The exchange's own company
 *  pages publish the mapping (Reuters Code column), each verified:
 *
 *    EGS370O1C013 → NAPR  National Printing            (investing.com: EGX:NAPR)
 *    EGS659O1C015 → MKIT  Misr Kuwait Inv. & Trading   (egx.com.eg: MKIT.CA)
 *    EGS385S1C012 → FERC  Ferchem Misr                 (egx.com.eg: FERC.CA)
 *    EGS65861C014 → EGCN  Egyptian Contracting (Al-Abd)(egx.com.eg: EGCN.CA)
 *    EGS73M81C012 → NAMI  National Asset Mgmt & Inv.   (egx.com.eg: NAMI.CA)
 *    EGS72L31C011 → SLAR  SOLARSOL For Energy          (ticker SLAR.EGX / SLAR.CA)
 *    EGS65621C012 → ENHD  El Nasr Housing & Development(egx.com.eg: ENHD.CA)
 *    EGS65101C015 → NIRE  National Inv. & Reconstruction(NIRCO: NIRE.CA)
 *
 *  The alias is applied at the universe level (market.ts), so tables, the
 *  narrative, screener, watchlist, company pages and agent tools all show
 *  the readable code. The reverse map exists because Yahoo Finance's EGX
 *  history serves these names under the ISIN form (EGS370O1C013.CA), and
 *  legacy URLs / localStorage / alerts may still carry the old code —
 *  resolveTicker() accepts either form and canonicalizes.
 *
 *  Client-safe by design: pure data + functions, zero imports. */

/** ISIN-shaped TradingView symbol → the exchange's Reuters ticker. */
export const TICKER_ALIASES: Record<string, string> = {
  EGS370O1C013: "NAPR",
  EGS659O1C015: "MKIT",
  EGS385S1C012: "FERC",
  EGS65861C014: "EGCN",
  EGS73M81C012: "NAMI",
  EGS72L31C011: "SLAR",
  EGS65621C012: "ENHD",
  EGS65101C015: "NIRE",
  // the three the first audit pass missed: TradingView serves these with an
  // "-EGP" suffix (EGS3E071C013-EGP) — verified the same way:
  //   ACRO (Acrow Misr — egx.com.eg release "ACRO.CA", investing EGX:ACRO)
  //   DIFC (International Dry Ice — investing.com ticker DIFC)
  //   ESAC (Egypt-South Africa for Communications — investing.com ESAC)
  "EGS3E071C013-EGP": "ACRO",
  "EGS30AJ1C016-EGP": "DIFC",
  "EGS48271C018-EGP": "ESAC",
};

/** Reuters ticker → the ISIN-shaped symbol the upstream feeds use. */
export const TICKER_DEALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(TICKER_ALIASES).map(([isin, reuters]) => [reuters, isin])
);

// dash-stripped keys — arg sanitizers (cleanTicker, history fetchers) often
// remove "-" before we see the symbol, so lookups must survive that
const ALIAS_BY_NODASH = new Map<string, string>(
  Object.entries(TICKER_ALIASES).map(([k, v]) => [k.replace(/-/g, ""), v])
);

/** Canonical, user-facing ticker: maps ISIN-shaped codes (with or without
 *  the "-EGP" suffix) to the Reuters ticker; anything else passes through. */
export function prettyTicker(t: string): string {
  return resolveTicker(t);
}

/** Resolve ANY historical form (ISIN-shaped, dashed or dash-stripped, or
 *  Reuters) to the canonical Reuters ticker — for URL params, localStorage
 *  payloads, agent args and alert rules written before the alias existed. */
export function resolveTicker(t: string): string {
  if (!t) return t;
  const direct = TICKER_ALIASES[t];
  if (direct) return direct;
  return ALIAS_BY_NODASH.get(t.replace(/-/g, "")) ?? t;
}

/** The symbol the HISTORY feed (Yahoo Finance EGX) expects: the exact
 *  ISIN-shaped form (Yahoo serves EGS370O1C013.CA and EGS30AJ1C016-EGP.CA,
 *  not NAPR.CA / DIFC.CA), unchanged for everything else. Accepts any input
 *  form — it canonicalizes first, then maps to the upstream symbol. */
export function historySymbol(t: string): string {
  const canon = resolveTicker(t);
  return TICKER_DEALIASES[canon] ?? canon;
}
