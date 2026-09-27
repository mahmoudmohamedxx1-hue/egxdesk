#!/usr/bin/env python3
"""Backfill ONE session's market breadth (2026-09-10) from real Yahoo daily
candles: for every listed ticker, compare the session close vs the previous
session close — up / down / flat counts. This is the same full-universe
methodology as the live breadth writer (counted ~295), richer than EGXBot's
traded-only counting. One-time repair for the session whose EGXBot archive
page is a stub with no breadth block."""
import json
import re
import sqlite3
import time
import urllib.request

DATE = "2026-09-10"
PREV = "2026-09-09"  # the actual previous trading session
DB = "/home/z/my-project/db/custom.db"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

# 1. ticker list from the running app's live universe
req = urllib.request.Request("http://localhost:3000/api/companies", headers=UA)
with urllib.request.urlopen(req, timeout=30) as r:
    companies = json.load(r)["rows"]
tickers = [c.get("ticker") for c in companies if c.get("ticker")]
print(f"universe tickers: {len(tickers)}")

def candles(ticker, tries=2):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}.CA?range=1mo&interval=1d&includePrePost=false"
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=12) as r:
                j = json.load(r)
            res = j.get("chart", {}).get("result") or [None]
            res = res[0]
            if not res:
                return None
            ts = res.get("timestamp") or []
            closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
            out = {}
            for t, c in zip(ts, closes):
                if isinstance(c, (int, float)):
                    d = time.strftime("%Y-%m-%d", time.gmtime(t + 3 * 3600))  # Cairo day
                    out[d] = c
            return out
        except Exception:
            if attempt + 1 < tries:
                time.sleep(1.2)
    return None

up = down = flat = 0
n = 0
for i, t in enumerate(tickers):
    c = candles(t)
    if c and DATE in c and PREV in c:
        n += 1
        if c[DATE] > c[PREV]:
            up += 1
        elif c[DATE] < c[PREV]:
            down += 1
        else:
            flat += 1
    if i % 40 == 0:
        print(f"  …{i}/{len(tickers)} (matched {n})")
    time.sleep(0.35)

print(f"\n{DATE} breadth from Yahoo candles (matched {n} symbols):")
print(f"  up={up} down={down} flat={flat} counted={up+down+flat}")

if n >= 150:  # sanity: a real session breadth needs broad coverage
    conn = sqlite3.connect(DB)
    conn.execute(
        "INSERT OR REPLACE INTO BreadthDay (date, up, down, flat, counted, source, capturedAt) VALUES (?,?,?,?,?, 'yahoo-candles', datetime('now'))",
        (DATE, up, down, flat, up + down + flat))
    conn.commit()
    conn.close()
    print("stored ✓")
else:
    print("coverage too low — NOT stored")
