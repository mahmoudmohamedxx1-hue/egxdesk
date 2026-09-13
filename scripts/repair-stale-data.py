#!/usr/bin/env python3
"""Task 23 data repair — one-time cleanup of the stale-graph bugs:

1. FlowDay phantom rows: sessions captured overnight/weekend under stray HTML
   dates but containing the PREVIOUS session's figures (verified identical
   values) — delete the row + its FlowCat children.
2. BreadthDay backfill: trading sessions present in IndexDay but missing a
   breadth row (the frozen-home-chart gap, e.g. Sep 8-10) — fetch the EGXBot
   archive page per date and store صاعدة/هابطة/بدون تغيير.
3. IndexDay repair: rows where egx70/egx100 are null (the "(EWI)" regex miss)
   — re-fetch the archive page and fill with the fixed pattern.
"""
import re
import sqlite3
import time
import urllib.request

DB = "/home/z/my-project/db/custom.db"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
conn = sqlite3.connect(DB)
cur = conn.cursor()

def fetch(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", "replace")

def page_text(html):
    html = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text)

def parse_breadth(text):
    # (a) current report's Arabic table
    m = re.search(r"شركات\s*صاعدة\D{0,10}(\d+)\D{0,40}?شركات\s*هابطة\D{0,10}(\d+)\D{0,40}?بدون\s*تغيير\D{0,10}(\d+)", text)
    # (b) archive pages' English narrative (several phrasings observed)
    if not m:
        m = re.search(
            r"(\d+)\s+(?:advancers?|gainers?|(?:stocks?|companies?|shares?)\s+(?:rose|advanced|gained|climbed))"
            r"\s*(?:versus|vs\.?|and|to)\s+(\d+)\s+(?:decliners?|losers?|(?:stocks?|companies?|shares?)\s+(?:declined|fell|dropped))"
            r"\s*[(;]?\s*(?:and\s+)?(\d+)\s+unchanged", text, re.I)
    if not m:
        return None
    up, down, flat = (int(g) for g in m.groups())
    return (up, down, flat) if all(0 <= v <= 600 for v in (up, down, flat)) else None

def parse_indices(text):
    def pick(pattern, lo, hi):
        for m in re.finditer(pattern, text, re.I):
            v = float(m.group(1).replace(",", ""))
            if lo < v < hi:
                return v
        return None
    ewi = r"(?:\s*\(\s*EWI\s*\))?"
    return (
        pick(rf"EGX70{ewi}\s*([\d][\d,.]*)", 4000, 60000),
        pick(rf"EGX100{ewi}\s*([\d][\d,.]*)", 8000, 80000),
    )

# ── 1. phantom FlowDay rows ─────────────────────────────────────────────
print("== FlowDay rows (newest 8) ==")
rows = cur.execute("SELECT date, totalBuy, turnover FROM FlowDay ORDER BY date DESC LIMIT 8").fetchall()
for r in rows:
    print("  ", r)

phantoms = []
prev = None
for date, tb, to in sorted(cur.execute("SELECT date, totalBuy, turnover FROM FlowDay").fetchall()):
    if prev and tb == prev[1] and to == prev[2] and date != prev[0]:
        phantoms.append((date, prev[0]))
    prev = (date, tb, to)
print("phantom (identical to predecessor):", phantoms)
for date, orig in phantoms:
    cur.execute("DELETE FROM FlowCat WHERE date = ?", (date,))
    cur.execute("DELETE FROM FlowDay WHERE date = ?", (date,))
    print(f"  deleted {date} (duplicate of {orig})")

# ── 2. BreadthDay backfill ──────────────────────────────────────────────
sessions = [d for (d,) in cur.execute(
    "SELECT date FROM IndexDay ORDER BY date DESC LIMIT 70").fetchall()]
have = {d for (d,) in cur.execute("SELECT date FROM BreadthDay").fetchall()}
missing = [d for d in sessions if d not in have]
print(f"\n== BreadthDay backfill: {len(missing)} missing sessions ==")
for d in missing:
    try:
        text = page_text(fetch(f"https://egxbot.com/en/market-report/{d}"))
        b = parse_breadth(text)
        if b:
            up, down, flat = b
            cur.execute(
                "INSERT OR REPLACE INTO BreadthDay (date, up, down, flat, counted, source, capturedAt) VALUES (?,?,?,?,?,'egxbot',datetime('now'))",
                (d, up, down, flat, up + down + flat))
            print(f"  {d}: up={up} down={down} flat={flat} ✓")
        else:
            print(f"  {d}: no breadth block on page (holiday?) — skipped")
    except Exception as e:
        print(f"  {d}: fetch failed ({e})")
    time.sleep(0.8)

# ── 3. IndexDay egx70/egx100 repair ─────────────────────────────────────
broken = cur.execute(
    "SELECT date, egx30 FROM IndexDay WHERE (egx70 IS NULL OR egx100 IS NULL) AND date >= date('now','-21 day') ORDER BY date DESC"
).fetchall()
print(f"\n== IndexDay repair: {len(broken)} rows with null egx70/egx100 ==")
for date, egx30 in broken:
    try:
        text = page_text(fetch(f"https://egxbot.com/en/market-report/{date}"))
        egx70, egx100 = parse_indices(text)
        if egx30 is None:
            m = re.search(r"EGX30\D{0,40}?([\d,]{6,})", text)
            if m:
                egx30 = float(m.group(1).replace(",", ""))
        if egx70 or egx100:
            cur.execute(
                "UPDATE IndexDay SET egx30=COALESCE(?, egx30), egx70=COALESCE(?, egx70), egx100=COALESCE(?, egx100), capturedAt=datetime('now') WHERE date=?",
                (egx30, egx70, egx100, date))
            print(f"  {date}: egx70={egx70} egx100={egx100} ✓")
        else:
            print(f"  {date}: still no index values on page — left as-is")
    except Exception as e:
        print(f"  {date}: fetch failed ({e})")
    time.sleep(0.8)

conn.commit()
conn.close()
print("\nRepair done.")
