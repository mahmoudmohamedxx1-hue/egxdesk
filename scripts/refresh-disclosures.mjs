/** T60 — disclosures archive refresh (المستجدات → الإفصاحات).
 *
 *  Pulls the parsed EGX disclosure feed (the exchange's own public
 *  disclosure announcements, parsed and classified) exactly like the
 *  ownership-lens refresh does, and MERGES it into src/data/disclosures.json
 *  by filing id — so the archive accumulates one day at a time in the repo
 *  and the agenda's month strip fills itself as the workflow runs daily.
 *
 *  Env: ESTHMR_COOKIE ("esthmr_session=<value>") — the user's own session.
 *  Fails SAFE: on any error the shipped archive stays untouched. */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "src/data/disclosures.json");
const FEED_URL = "https://esthmr.com/data/v1/disclosures/latest.json";
const RETENTION_DAYS = 400;

async function main() {
  const cookie = process.env.ESTHMR_COOKIE || "";
  if (!cookie) throw new Error("ESTHMR_COOKIE not set");
  const res = await fetch(FEED_URL, {
    headers: { Cookie: cookie.startsWith("esthmr_session") ? cookie : `esthmr_session=${cookie}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`disclosures fetch ${res.status}`);
  const doc = await res.json();
  const items = Array.isArray(doc.items) ? doc.items : [];
  if (!items.length) throw new Error("disclosures document empty");

  const compact = (x) => ({
    id: String(x.id ?? ""),
    title: String(x.title ?? ""),
    titleEn: typeof x.title_en === "string" ? x.title_en : null,
    date: String(x.date ?? ""),
    link: String(x.link ?? ""),
    tickers: Array.isArray(x.tickers) ? x.tickers.slice(0, 3) : [],
    event: String(x.event ?? "other"),
    eventLabelAr: String(x.event_label_ar ?? ""),
    eventLabelEn: String(x.event_label ?? ""),
    meaningAr: typeof x.meaning_ar === "string" ? x.meaning_ar : null,
    meaningEn: typeof x.meaning === "string" ? x.meaning : null,
  });

  const fresh = items.map(compact).filter((x) => x.id && x.date && x.title);

  // merge with the shipped archive (keep old items the feed no longer lists)
  let prev = [];
  try {
    const old = JSON.parse(fs.readFileSync(OUT, "utf8"));
    if (Array.isArray(old.items)) prev = old.items;
  } catch {}
  const byId = new Map();
  for (const x of prev) byId.set(x.id, x);
  for (const x of fresh) byId.set(x.id, x);
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
  const merged = [...byId.values()].filter((x) => x.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const out = {
    asOf: new Date().toISOString(),
    source: { nameAr: "البورصة المصرية", name: "The Egyptian Exchange", home: "https://www.egx.com.eg" },
    count: merged.length,
    items: merged,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`disclosures: ${prev.length} shipped + ${fresh.length} fresh → ${merged.length} merged items (${merged[merged.length - 1]?.date} → ${merged[0]?.date})`);
}

main().catch((e) => {
  console.error("disclosures refresh FAILED (shipped archive untouched):", String(e).slice(0, 200));
  process.exit(1);
});
