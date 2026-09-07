#!/usr/bin/env python3
"""Import esthmr's 260-session index history (EGX30/70/100 + breadth) into
the IndexDay table, merging over our EGXBot-captured rows (upsert).
Also back-fills a market-breadth series into the new BreadthDay table."""

import json, os, sys

# prisma client (project venv)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("DATABASE_URL", "file:" + os.path.abspath("../db/custom.db is not it"))

DB = "/home/z/my-project/db/custom.db"
HIST = "/home/z/my-project/scripts/research/esthmr-src/market-history.json"

import sqlite3

hist = json.load(open(HIST))
sessions = hist.get("sessions", [])
print(f"sessions in doc: {len(sessions)} ({sessions[0]['date']} → {sessions[-1]['date']})")

con = sqlite3.connect(DB)
cur = con.cursor()

# ensure BreadthDay table exists (mirrors prisma schema push below)
cur.execute("""
CREATE TABLE IF NOT EXISTS "BreadthDay" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "up" INTEGER,
    "down" INTEGER,
    "flat" INTEGER,
    "counted" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'esthmr',
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)
""")

idx_rows = 0
breadth_rows = 0
for s in sessions:
    d = s["date"]
    idx = s.get("indices", {})
    egx30 = idx.get("EGX30")
    egx70 = idx.get("EGX70EWI")
    egx100 = idx.get("EGX100EWI")
    if egx30 is not None or egx70 is not None or egx100 is not None:
        cur.execute(
            """INSERT INTO IndexDay (date, egx30, egx70, egx100, source, capturedAt)
               VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
               ON CONFLICT(date) DO UPDATE SET
                 egx30 = COALESCE(excluded.egx30, egx30),
                 egx70 = COALESCE(excluded.egx70, egx70),
                 egx100 = COALESCE(excluded.egx100, egx100),
                 source = 'esthmr+egxbot'""",
            (d, egx30, egx70, egx100, "esthmr+egxbot"),
        )
        idx_rows += 1
    b = s.get("breadth")
    if b and b.get("counted"):
        cur.execute(
            """INSERT INTO BreadthDay (date, up, down, flat, counted, source, capturedAt)
               VALUES (?,?,?,?,?,'esthmr',CURRENT_TIMESTAMP)
               ON CONFLICT(date) DO UPDATE SET
                 up=excluded.up, down=excluded.down, flat=excluded.flat,
                 counted=excluded.counted, source='esthmr'""",
            (d, b.get("up"), b.get("down"), b.get("flat"), b.get("counted")),
        )
        breadth_rows += 1

con.commit()
total = cur.execute("SELECT COUNT(*) FROM IndexDay").fetchone()[0]
btotal = cur.execute("SELECT COUNT(*) FROM BreadthDay").fetchone()[0]
first, last = cur.execute("SELECT MIN(date), MAX(date) FROM IndexDay").fetchone()
print(f"upserted {idx_rows} index sessions, {breadth_rows} breadth days")
print(f"IndexDay total: {total} ({first} → {last}); BreadthDay total: {btotal}")
con.close()
