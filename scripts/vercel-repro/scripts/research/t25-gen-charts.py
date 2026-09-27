#!/usr/bin/env python3
"""T25 report charts — follows typesetting/charts.md (no top/right spines,
dashed grid 20% opacity, legend frameless, first/last/max/min labels only).
Colors from palette.cascade seed 7 (warm gold family). English labels only.
C3 uses EGX Desk's own live API (207 real sessions)."""
import json
import urllib.request
import matplotlib
matplotlib.use("Agg")
import matplotlib.font_manager as fm
for f in (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf",
):
    try:
        fm.fontManager.addfont(f)
    except Exception:
        pass
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["DejaVu Sans", "Noto Sans SC"]
plt.rcParams["axes.unicode_minus"] = False

# ── cascade palette (seed 7) ──────────────────────────────────────────────
ACCENT = "#87702a"
ACCENT_2 = "#3a95b4"
HEADER_FILL = "#504933"
ICON = "#8c7e52"
TEXT = "#1c1c1a"
MUTED = "#78766f"
BORDER = "#cfcab8"
STRIPE = "#eeedeb"
ERR = "#92453e"

OUT = "/home/z/my-project/scripts/research/t25"


def style_ax(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color(BORDER)
    ax.spines["bottom"].set_color(BORDER)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.grid(True, linestyle="--", linewidth=0.5, alpha=0.2, color=HEADER_FILL)


# ═══ C1: capability coverage scores (EGX-lens, 28 capabilities) ═══════════
scores = [
    ("EGX Desk", 20.5),
    ("TradingView (free/EGX)", 15.0),
    ("Stockastic (Pro tier)", 14.0),
    ("Mubasher ecosystem", 14.0),
    ("esthmr.com", 11.0),
    ("Investing.com", 10.5),
    ("Thndr (broker app)", 10.0),
    ("EGX official (site+app)", 9.0),
    ("Yahoo Finance", 9.0),
    ("Argaam", 8.0),
    ("Simply Wall St", 6.5),
    ("StockAnalysis.com", 6.0),
    ("Koyfin", 4.5),
    ("Finviz (EGX n/a)", 2.0),
]
fig, ax = plt.subplots(figsize=(8.6, 5.2), constrained_layout=True)
names = [s[0] for s in scores][::-1]
vals = [s[1] for s in scores][::-1]
bar_colors = [ACCENT if n == "EGX Desk" else ICON for n in names]
bars = ax.barh(names, vals, color=bar_colors, height=0.62, edgecolor="none")
for b, v, n in zip(bars, vals, names):
    ax.text(v + 0.35, b.get_y() + b.get_height() / 2, f"{v:g}",
            va="center", ha="left", fontsize=9,
            color=TEXT if n == "EGX Desk" else MUTED,
            fontweight="bold" if n == "EGX Desk" else "normal")
ax.set_xlim(0, 24.5)
ax.set_xlabel("Capability coverage of 28 benchmarked capabilities (EGX-lens scoring)", fontsize=9, color=MUTED)
style_ax(ax)
ax.grid(axis="y", visible=False)
fig.savefig(f"{OUT}/c1-coverage.png", dpi=200)
plt.close(fig)

# ═══ C2: positioning map — Egypt focus × AI-native depth ═════════════════
pts = [
    # name, egypt_focus (0-10), ai_depth (0-10), highlight?
    ("TradingView", 2.0, 6.0, 0),
    ("Investing.com", 3.0, 4.0, 0),
    ("Yahoo Finance", 2.5, 3.0, 0),
    ("Simply Wall St", 2.0, 3.5, 0),
    ("StockAnalysis.com", 2.5, 2.0, 0),
    ("Finviz", 0.5, 3.0, 0),
    ("Koyfin", 1.0, 2.0, 0),
    ("Danelfin", 0.5, 8.0, 0),
    ("AltIndex", 0.5, 8.5, 0),
    ("Intellectia", 1.0, 8.5, 0),
    ("Mubasher Smart Signals", 7.5, 5.0, 0),
    ("Argaam", 7.0, 1.5, 0),
    ("EGX official", 10.0, 0.3, 0),
    ("Thndr", 9.5, 1.0, 0),
    ("Stockastic", 9.0, 8.0, 0),
    ("esthmr.com", 8.5, 2.0, 0),
    ("EGX DESK", 9.5, 9.3, 1),
]
# manual label offsets to avoid collisions (pt-relative, dx,dy in points)
off = {
    "TradingView": (-6, 6), "Investing.com": (-6, 6), "Yahoo Finance": (6, -3),
    "Simply Wall St": (6, -12), "StockAnalysis.com": (6, 4), "Finviz": (6, -3),
    "Koyfin": (6, 4), "Danelfin": (6, -3), "AltIndex": (-6, -12),
    "Intellectia": (6, 4), "Mubasher Smart Signals": (-10, 4), "Argaam": (6, -3),
    "EGX official": (-6, 8), "Thndr": (6, -12), "Stockastic": (-8, -16),
    "esthmr.com": (6, 4), "EGX DESK": (-14, -4),
}
fig, ax = plt.subplots(figsize=(8.6, 6.4), constrained_layout=True)
for name, x, y, hl in pts:
    ax.scatter(x, y, s=430 if hl else 90, color=ACCENT if hl else ICON,
               alpha=1.0 if hl else 0.75, zorder=3, edgecolors="white", linewidths=1.2)
    dx, dy = off.get(name, (6, 4))
    ax.annotate(name, (x, y), textcoords="offset points", xytext=(dx, dy),
                ha="center", fontsize=8.5 if not hl else 10.5,
                fontweight="bold" if hl else "normal",
                color=TEXT if hl else MUTED, zorder=4)
# quadrant guides
ax.axvline(5, color=BORDER, linewidth=0.8, linestyle="--", zorder=1)
ax.axhline(5, color=BORDER, linewidth=0.8, linestyle="--", zorder=1)
ax.text(2.5, 9.65, "AI-native, global", fontsize=8, color=MUTED, style="italic", ha="center")
ax.text(7.5, 9.65, "AI-native, Egypt-focused", fontsize=8, color=MUTED, style="italic", ha="center")
ax.text(2.5, 0.35, "Traditional, global", fontsize=8, color=MUTED, style="italic", ha="center")
ax.text(7.5, 0.35, "Traditional, Egypt-focused", fontsize=8, color=MUTED, style="italic", ha="center")
ax.set_xlim(0, 10)
ax.set_ylim(0, 10)
ax.set_xlabel("Egypt / EGX market focus", fontsize=10, color=TEXT)
ax.set_ylabel("AI-native capability depth", fontsize=10, color=TEXT)
style_ax(ax)
ax.grid(visible=False)
fig.savefig(f"{OUT}/c2-positioning.png", dpi=200)
plt.close(fig)

# ═══ C3: EGX30 real history from our own API ══════════════════════════════
try:
    with urllib.request.urlopen(
        "http://localhost:3000/api/chart?symbol=EGX30&range=1Y", timeout=20
    ) as r:
        d = json.loads(r.read().decode())
    pts3 = d["points"]
    dates = [p["date"] for p in pts3]
    closes = [p["close"] for p in pts3]
    x = list(range(len(closes)))
    fig, ax = plt.subplots(figsize=(8.6, 4.3), constrained_layout=True)
    ax.plot(x, closes, color=ACCENT, linewidth=2.2, zorder=3, solid_capstyle="round")
    ax.fill_between(x, closes, min(closes) * 0.985, color=ACCENT, alpha=0.10, zorder=2)
    # first / last / max / min labels only (charts.md line strategy)
    key_idx = {
        0: "first",
        len(closes) - 1: "last",
        closes.index(max(closes)): "max",
        closes.index(min(closes)): "min",
    }
    for i, kind in key_idx.items():
        ax.scatter([i], [closes[i]], s=22, color=HEADER_FILL, zorder=4)
        dy = 10 if kind in ("max", "last") else -14
        if kind == "max":
            dy = 12
        if kind == "min":
            dy = -14
        ax.annotate(f"{closes[i]:,.0f}", (i, closes[i]), textcoords="offset points",
                    xytext=(0, dy), ha="center", fontsize=8.5, color=TEXT, zorder=5)
    ticks = list(range(0, len(x), max(1, len(x) // 8)))
    ax.set_xticks(ticks)
    ax.set_xticklabels([dates[i][:7] for i in ticks], fontsize=8.5)
    ax.set_ylabel("EGX 30 close (EGP)", fontsize=10, color=TEXT)
    style_ax(ax)
    fig.savefig(f"{OUT}/c3-egx30.png", dpi=200)
    plt.close(fig)
    print(f"C3 OK: {len(closes)} sessions {dates[0]}..{dates[-1]} last={closes[-1]:,.2f}")
except Exception as e:
    print("C3 FAILED:", e)

print("C1 OK, C2 OK")
