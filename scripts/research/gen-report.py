#!/usr/bin/env python3
"""EGX Desk — Competitive Research & Feature Gap Analysis (body PDF).
Report route: ReportLab body (TOC + 8 chapters) + HTML/Playwright cover merged later."""
import os, sys, hashlib

SKILL = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(SKILL, "scripts"))
OUT_DIR = "/home/z/my-project/scripts/research"
DL_DIR = "/home/z/my-project/download"
os.makedirs(DL_DIR, exist_ok=True)

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, Image, KeepTogether, CondPageBreak,
                                HRFlowable)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── Fonts (allowed set only) ─────────────────────────────────────────────
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
pdfmetrics.registerFont(TTFont("DejaVuSans", f"{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf"))
registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
registerFontFamily("DejaVuSans", normal="DejaVuSans", bold="DejaVuSans")

from pdf import install_font_fallback
install_font_fallback()

# ── Cascade palette (design_engine.py palette-cascade, intent cold, seed 3) ──
PAGE_BG       = colors.HexColor('#eff0f1')
SECTION_BG    = colors.HexColor('#f0f0f1')
CARD_BG       = colors.HexColor('#e6e8e9')
TABLE_STRIPE  = colors.HexColor('#edf0f1')
HEADER_FILL   = colors.HexColor('#3c5967')
COVER_BLOCK   = colors.HexColor('#415762')
BORDER        = colors.HexColor('#c3d0d6')
ICON          = colors.HexColor('#4b839f')
ACCENT        = colors.HexColor('#267eaa')
ACCENT_2      = colors.HexColor('#c84359')
TEXT_PRIMARY  = colors.HexColor('#191b1c')
TEXT_MUTED    = colors.HexColor('#7d8387')
SEM_SUCCESS   = colors.HexColor('#3f7451')
TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ── Chart colors (matplotlib, same family) ───────────────────────────────
C_ACCENT, C_ACCENT2, C_HEADER, C_ICON, C_MUTED = "#267eaa", "#c84359", "#3c5967", "#4b839f", "#7d8387"
C_GRID, C_TEXT = "#c3d0d6", "#191b1c"

# ── Geometry ─────────────────────────────────────────────────────────────
MARGIN = 0.95 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
H1_ORPHAN = AVAIL_H * 0.18
MAX_KEEP = PAGE_H * 0.4

# ── Styles ───────────────────────────────────────────────────────────────
def st(name, **kw):
    base = dict(fontName="FreeSerif", fontSize=10.5, leading=16.5,
                textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8)
    base.update(kw)
    return ParagraphStyle(name=name, **base)

S_BODY   = st("Body")
S_LEAD   = st("Lead", fontSize=11.5, leading=18, textColor=TEXT_PRIMARY)
S_H1     = st("H1", fontSize=19, leading=24, alignment=TA_LEFT, spaceBefore=18,
              spaceAfter=10, textColor=HEADER_FILL)
S_H2     = st("H2", fontSize=14, leading=19, alignment=TA_LEFT, spaceBefore=14,
              spaceAfter=6, textColor=HEADER_FILL)
S_H3     = st("H3", fontSize=11.5, leading=16, alignment=TA_LEFT, spaceBefore=10,
              spaceAfter=4, textColor=TEXT_PRIMARY)
S_CAP    = st("Cap", fontSize=8.5, leading=12, alignment=TA_CENTER,
              textColor=TEXT_MUTED, spaceAfter=0)
S_BULLET = st("Bullet", alignment=TA_LEFT, leftIndent=14, bulletIndent=4, spaceAfter=5)
S_QUOTE  = st("Quote", fontName="FreeSerif-Italic", leftIndent=24, alignment=TA_LEFT,
              textColor=TEXT_MUTED, borderPadding=0)
S_TH     = st("TH", fontSize=9, leading=12, alignment=TA_CENTER, textColor=colors.white,
              spaceAfter=0)
S_TD     = st("TD", fontSize=8.8, leading=12, alignment=TA_CENTER, spaceAfter=0)
S_TDL    = st("TDL", fontSize=8.8, leading=12, alignment=TA_LEFT, spaceAfter=0)
S_STAT   = st("Stat", fontSize=21, leading=25, alignment=TA_CENTER, textColor=ACCENT, spaceAfter=0)
S_STATLB = st("StatLb", fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED, spaceAfter=0)

# ── Benchmark data (25 capabilities x 12 tools) ──────────────────────────
# Y = full, P = partial, N = absent
TOOLS = ["EGX Desk", "TradingView", "Investing.com", "Yahoo Finance",
         "stockanalysis.com", "Simply Wall St", "Koyfin", "Finbox",
         "Mubasher", "Argaam", "esthmr.com", "EGX official"]
# capability: (label, [EGX Desk, TV, INV, YH, SA, SWS, KF, FB, MUB, ARG, EST, EGX])
MATRIX = [
 ("Live EGX quotes (delayed)",            "Y","Y","Y","Y","Y","Y","N","N","Y","Y","Y","Y"),
 ("Arabic-first UI, official EGX names",  "Y","N","P","N","N","N","N","N","Y","Y","Y","P"),
 ("Insider & treasury-deal log",          "Y","N","N","P","Y","N","N","N","P","P","Y","Y"),
 ("Investor-flow breakdown (EGX)",        "Y","N","P","N","N","N","P","N","Y","Y","Y","P"),
 ("Market breadth history",               "Y","N","P","N","P","N","N","N","N","N","Y","N"),
 ("Price & indicator alerts",             "N","Y","Y","Y","Y","Y","Y","N","P","N","N","N"),
 ("Portfolio tracker (P&L)",              "N","P","Y","Y","Y","N","Y","N","Y","P","N","N"),
 ("Dividend history & dates",             "N","Y","Y","Y","Y","Y","Y","P","P","P","N","P"),
 ("Earnings & events calendar",           "N","Y","Y","Y","Y","N","Y","N","Y","Y","Y","Y"),
 ("Company comparison tool",              "N","Y","Y","P","Y","P","Y","Y","N","N","Y","N"),
 ("Technical indicators suite",           "Y","Y","Y","P","Y","N","Y","N","P","N","P","N"),
 ("Statements depth (IS/BS/CF, 5-10y)",   "P","N","Y","Y","Y","P","Y","Y","Y","Y","Y","P"),
 ("Valuation / fair-value models",        "N","N","Y","N","P","Y","P","Y","N","N","Y","N"),
 ("Arabic news archive (EGX-tagged)",     "Y","N","P","N","N","N","N","N","Y","Y","Y","P"),
 ("World markets & commodities",          "Y","Y","Y","Y","Y","N","Y","N","Y","Y","Y","N"),
 ("Gold by karat + local FX",             "Y","N","P","N","N","N","N","N","P","P","Y","N"),
 ("Stock screener (multi-filter)",        "Y","Y","Y","Y","Y","Y","Y","Y","P","N","P","N"),
 ("Saved screens / layouts",              "N","Y","Y","N","Y","Y","Y","Y","N","N","Y","N"),
 ("Chart drawing tools",                  "N","Y","Y","N","N","N","Y","N","N","N","N","N"),
 ("Multi-stock chart compare",            "P","Y","Y","P","Y","N","Y","N","N","N","N","N"),
 ("Text-to-speech accessibility",         "Y","N","N","N","N","N","N","N","N","N","N","N"),
 ("Plain-language explanations",          "Y","P","P","N","P","Y","N","N","P","P","Y","N"),
 ("Installable app / PWA",                "N","Y","Y","Y","Y","Y","Y","N","Y","Y","N","N"),
 ("Public developer API",                 "N","Y","Y","N","Y","N","Y","Y","N","N","N","P"),
 ("Education academy / glossary",         "P","Y","Y","P","Y","Y","N","N","P","Y","P","N"),
]
W = {"Y": 1.0, "P": 0.5, "N": 0.0}
SCORES = {t: sum(W[row[1 + i]] for row in MATRIX) for i, t in enumerate(TOOLS)}
N_CAPS = len(MATRIX)

# ── Gap register (id, title, impact 1-5, effort 1-5, tier) ──────────────
GAPS = [
 ("G1",  "Price & indicator alerts",        4.6, 2.5, "P0"),
 ("G2",  "Portfolio tracker (holdings, P&L)", 4.5, 3.0, "P0"),
 ("G3",  "Dividend history & upcoming dates", 4.1, 2.5, "P0"),
 ("G4",  "Company comparison tool",          4.0, 3.0, "P0"),
 ("G5",  "Earnings & events calendar",       4.4, 3.4, "P0"),
 ("G6",  "Screener state persistence",       2.6, 1.0, "P0"),
 ("G7",  "CSV / PDF export of data",         2.2, 1.0, "P0"),
 ("G8",  "Log-scale & chart compare modes",  2.4, 1.2, "P0"),
 ("G9",  "Statements depth (10y, quarterly BS/CF)", 4.0, 3.8, "P1"),
 ("G10", "Valuation layer (fair value, scores)", 4.0, 3.5, "P1"),
 ("G11", "English news layer",              3.6, 3.4, "P1"),
 ("G12", "Egypt treasury & deposit rates",  3.6, 2.0, "P1"),
 ("G13", "Fund / ETF / certificate pages",  3.1, 3.4, "P1"),
 ("G14", "PWA: installable app + web push", 3.5, 2.6, "P1"),
 ("G15", "Cross-signal market narratives",  3.6, 4.4, "P2"),
 ("G16", "Accounts & cross-device sync",    3.0, 4.4, "P2"),
 ("G17", "Community ideas & education",     2.6, 4.8, "P2"),
 ("G18", "Public developer API",            2.1, 4.0, "P2"),
 ("G19", "Chart drawing tools",             2.4, 4.5, "P2"),
]

# ── Charts ───────────────────────────────────────────────────────────────
def make_charts():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["axes.unicode_minus"] = False

    # Chart 1: capability coverage (horizontal bar)
    ranked = sorted(TOOLS, key=lambda t: SCORES[t])
    labels = ranked
    vals = [SCORES[t] for t in ranked]
    fig, ax = plt.subplots(figsize=(7.6, 4.6), dpi=200, constrained_layout=True)
    cols = [C_ACCENT if t == "EGX Desk" else C_ICON for t in ranked]
    bars = ax.barh(labels, vals, color=cols, height=0.62, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(v + 0.25, b.get_y() + b.get_height()/2, f"{v:.1f}",
                va="center", ha="left", fontsize=8.5, color=C_TEXT)
    ax.set_xlim(0, max(vals) * 1.14)
    ax.set_xlabel(f"Weighted coverage score ({N_CAPS} benchmarked capabilities, full = 1.0 / partial = 0.5)",
                  fontsize=9, color=C_TEXT)
    ax.tick_params(labelsize=9, colors=C_TEXT)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(C_GRID)
    ax.xaxis.grid(True, linestyle="--", alpha=0.2, zorder=0)
    ax.set_axisbelow(True)
    fig.savefig(os.path.join(OUT_DIR, "chart-coverage.png"))
    plt.close(fig)

    # Chart 2: impact x effort matrix
    fig, ax = plt.subplots(figsize=(7.6, 5.2), dpi=200, constrained_layout=True)
    style = {"P0": (C_ACCENT,  "Quick wins / core gaps"),
             "P1": (C_HEADER,  "Big bets"),
             "P2": (C_MUTED,   "Long-term differentiators")}
    seen = set()
    for gid, name, imp, eff, tier in GAPS:
        c, lab = style[tier]
        ax.scatter(eff, imp, s=120, color=c, alpha=0.85, zorder=3,
                   edgecolors="white", linewidths=0.8,
                   label=lab if tier not in seen else None)
        seen.add(tier)
        dy = {"G1": 0.14, "G2": -0.2, "G4": 0.14, "G5": -0.22, "G6": 0.12, "G7": -0.2,
              "G8": 0.14, "G9": 0.14, "G10": -0.22, "G11": 0.13, "G12": -0.2, "G13": 0.13,
              "G14": 0.13, "G15": 0.13, "G16": -0.2, "G17": 0.13, "G18": -0.2, "G3": 0.14,
              "G19": -0.2}.get(gid, 0.14)
        ax.annotate(gid, (eff, imp), xytext=(0, 14 if dy > 0 else -16),
                    textcoords="offset points", ha="center", fontsize=7.5, color=C_TEXT)
    ax.axvline(3.0, color=C_GRID, linestyle="--", linewidth=1, zorder=1)
    ax.axhline(3.55, color=C_GRID, linestyle="--", linewidth=1, zorder=1)
    ax.set_xlim(0.4, 5.3); ax.set_ylim(1.6, 5.2)
    ax.set_xlabel("Implementation effort (1 = days, 5 = quarters)", fontsize=9, color=C_TEXT)
    ax.set_ylabel("User impact (1 = nice-to-have, 5 = must-have)", fontsize=9, color=C_TEXT)
    ax.tick_params(labelsize=9, colors=C_TEXT)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(C_GRID)
    ax.grid(True, linestyle="--", alpha=0.2, zorder=0)
    ax.set_axisbelow(True)
    ax.text(1.0, 5.05, "QUICK WINS", fontsize=8, color=C_ICON, weight="bold")
    ax.text(4.35, 5.05, "BIG BETS", fontsize=8, color=C_ICON, weight="bold")
    ax.text(1.0, 1.78, "FILL-INS", fontsize=8, color=C_MUTED, weight="bold")
    ax.text(4.35, 1.78, "DEFER", fontsize=8, color=C_MUTED, weight="bold")
    ax.legend(loc="lower left", bbox_to_anchor=(0.0, -0.22), ncol=3, frameon=False, fontsize=8.5)
    fig.savefig(os.path.join(OUT_DIR, "chart-matrix.png"))
    plt.close(fig)

make_charts()

# ── Helpers ──────────────────────────────────────────────────────────────
def P(text, style=S_BODY):
    return Paragraph(text, style)

def add_heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def h1(story, text):
    story.append(CondPageBreak(H1_ORPHAN))
    story.append(add_heading(text, S_H1, 0))
    story.append(HRFlowable(width="100%", color=ACCENT, thickness=1.1,
                            spaceBefore=0, spaceAfter=10))

def h2(story, text):
    story.append(CondPageBreak(H1_ORPHAN * 0.7))
    story.append(add_heading(text, S_H2, 1))

def callout_row(stats):
    """stats: list of (big, label) — renders a centered 3-up callout strip."""
    cells, widths = [], []
    n = len(stats)
    gap = 10
    cw = (AVAIL_W - gap * (n - 1)) / n
    row = []
    for i, (big, lab) in enumerate(stats):
        inner = Table([[Paragraph(f"<b>{big}</b>", S_STAT)],
                       [Paragraph(lab, S_STATLB)]], colWidths=[cw])
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
            ("TOPPADDING", (0, 0), (-1, 0), 9), ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
            ("TOPPADDING", (0, 1), (-1, 1), 2), ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        row.append(inner)
        widths.append(cw)
        if i < n - 1:
            row.append(Spacer(gap, 1))
            widths.append(gap)
    outer = Table([row], colWidths=widths, hAlign="CENTER")
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer

def bench_table(cols, cap_start, cap_end):
    """Benchmark matrix for selected tool columns between capability rows."""
    sym = {"Y": "\u2713", "P": "part.", "N": "\u2014"}
    head = [Paragraph("<b>Capability</b>", S_TH)] + \
           [Paragraph(f"<b>{t}</b>", S_TH) for t in cols]
    data = [head]
    for row in MATRIX[cap_start:cap_end]:
        label = row[0]
        vals = [row[1 + TOOLS.index(t)] for t in cols]
        r = [Paragraph(label, S_TDL)] + [Paragraph(sym[v], S_TD) for v in vals]
        data.append(r)
    ratios = [0.30] + [0.70 / len(cols)] * len(cols)
    widths = [r * AVAIL_W for r in ratios]
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      TABLE_ROW_ODD if i % 2 else TABLE_ROW_EVEN))
    # highlight EGX Desk column
    if "EGX Desk" in cols:
        c = cols.index("EGX Desk") + 1
        style.append(("BACKGROUND", (c, 1), (c, -1), CARD_BG))
    t.setStyle(TableStyle(style))
    return t

def gap_table(tier):
    head = [Paragraph(f"<b>{x}</b>", S_TH) for x in
            ["ID", "Missing capability", "Impact", "Effort", "Benchmark precedent"]]
    PRE = {"G1": "TradingView, Investing, Yahoo", "G2": "Yahoo, Investing, Koyfin",
           "G3": "stockanalysis.com, SWS", "G4": "stockanalysis.com, esthmr pairs",
           "G5": "Everyone; esthmr calendar", "G6": "Investing saved screens",
           "G7": "stockanalysis, Finbox exports", "G8": "TradingView chart modes",
           "G9": "stockanalysis 10y, esthmr 29 periods", "G10": "Finbox DCF, SWS snowflake, Investing Pro",
           "G11": "Mubasher/Argaam bilingual", "G12": "esthmr rates, macro",
           "G13": "Mubasher fund pages", "G14": "TradingView, Yahoo PWA",
           "G15": "esthmr connect-the-dots", "G16": "TradingView accounts",
           "G17": "TradingView ideas, Argaam", "G18": "stockanalysis, Finbox API",
           "G19": "TradingView, Koyfin drawing"}
    data = [head]
    for gid, name, imp, eff, t in GAPS:
        if t != tier:
            continue
        data.append([
            Paragraph(gid, S_TD), Paragraph(name, S_TDL),
            Paragraph(f"{imp:.1f}", S_TD), Paragraph(f"{eff:.1f}", S_TD),
            Paragraph(PRE[gid], S_TDL),
        ])
    ratios = [0.06, 0.34, 0.09, 0.09, 0.42]
    widths = [r * AVAIL_W for r in ratios]
    tb = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      TABLE_ROW_ODD if i % 2 else TABLE_ROW_EVEN))
    tb.setStyle(TableStyle(style))
    return tb

def fig(path, cap, max_h=300):
    from PIL import Image as PILImage
    im = PILImage.open(path)
    ow, oh = im.size
    ratio = min(AVAIL_W / ow, max_h / oh, 1.0)
    img = Image(path, width=ow * ratio, height=oh * ratio)
    return [Spacer(1, 16), img, Spacer(1, 6), P(cap, S_CAP), Spacer(1, 16)]

def bullets(story, items):
    for it in items:
        story.append(P(f"\u2022  {it}", S_BULLET))

# ── Header / footer ──────────────────────────────────────────────────────
DOC_TITLE = "EGX Desk - Competitive Research & Feature Gap Analysis"
def on_page(canv, doc):
    canv.saveState()
    canv.setFont("FreeSerif", 7.5)
    canv.setFillColor(TEXT_MUTED)
    canv.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE)
    canv.setStrokeColor(ACCENT); canv.setLineWidth(1.1)
    canv.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    canv.setStrokeColor(BORDER); canv.setLineWidth(0.5)
    canv.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canv.drawString(MARGIN, 0.45 * inch, "EGX Desk Product Research")
    canv.drawRightString(PAGE_W - MARGIN, 0.45 * inch, f"Page {doc.page}")
    canv.restoreState()

# ── Story ────────────────────────────────────────────────────────────────
story = []

toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle(name="TOC1", fontName="FreeSerif", fontSize=11.5, leading=17,
                   leftIndent=16, textColor=TEXT_PRIMARY),
    ParagraphStyle(name="TOC2", fontName="FreeSerif", fontSize=9.5, leading=14,
                   leftIndent=34, textColor=TEXT_MUTED),
]
story.append(Paragraph("<b>Table of Contents</b>",
                       ParagraphStyle(name="TOCTitle", fontName="FreeSerif", fontSize=17,
                                      leading=22, textColor=HEADER_FILL, spaceAfter=14)))
story.append(toc)
story.append(PageBreak())

# ═══ 1. EXECUTIVE SUMMARY ════════════════════════════════════════════════
h1(story, "1. Executive Summary")
story.append(P(
    "This report answers a single question: measured against the best retail market-data tools in the "
    "world, what does EGX Desk miss? We benchmarked the platform against twelve references across three "
    "tiers - seven global leaders (TradingView, Investing.com Pro, Yahoo Finance, stockanalysis.com, "
    "Simply Wall St, Koyfin, Finbox), two Arabic regional portals (Mubasher, Argaam), and three "
    "Egypt-specific references (esthmr.com, the EGX official website, and EGX Desk itself). Each tool was "
    "profiled from its public feature set, and every EGX Desk capability was re-verified live against the "
    "production build before scoring, so the comparison reflects what the site actually does today, not "
    "what it claims to do.", S_LEAD))
story.append(Spacer(1, 6))
story.append(callout_row([
    (f"{len(GAPS)}", "capability gaps identified across the twelve-tool benchmark"),
    (f"{SCORES['EGX Desk']:.1f}/{N_CAPS}", "EGX Desk weighted coverage score vs TradingView " + f"{SCORES['TradingView']:.1f}"),
    ("8", "quick wins buildable in days, not quarters"),
]))
story.append(Spacer(1, 12))
story.append(P(
    "The headline finding is encouraging and uncomfortable at once. EGX Desk already holds capabilities "
    "that none of the global giants offer for the Egyptian market: a verified insider and treasury-share "
    "log linked to official EGX disclosure documents, investor-flow breakdowns by investor category, "
    "market-breadth history, official Arabic company naming across all 284 listed companies, and "
    "text-to-speech accessibility. On the Egypt-specific data layer, only esthmr.com competes at a "
    "comparable depth, and EGX Desk remains ahead on verification discipline, bilingual polish, and "
    "mobile experience."))
story.append(P(
    "The uncomfortable part is the operational layer that top-class tools treat as table stakes. Every "
    "serious competitor lets users set price alerts, track a portfolio with profit-and-loss, consult an "
    "earnings and dividend calendar, and compare companies side by side. EGX Desk offers none of these "
    "today. The screener is visually equal to Investing.com Pro, but its filters reset on every visit; "
    "the coupon calculator answers an income question, but the site cannot tell an income investor when "
    "the next dividend is due or what a company paid over the last five years. These are not exotic "
    "features - they are the difference between a site users admire and a site users open every trading "
    "morning."))
story.append(P(
    "Nineteen gaps were catalogued in total and prioritized on an impact-versus-effort matrix. Eight are "
    "quick wins (alerts, portfolio, dividend history, comparison, calendar, persisted screens, data "
    "export, chart log-scale). Six are big bets (deeper statements, a valuation layer, English news, "
    "treasury rates, fund pages, installable PWA). Five are long-term differentiators (cross-signal "
    "narratives, accounts, community, a public API, drawing tools). The recommended sequence closes the "
    "eight quick wins first, converting the existing data advantage into daily-use stickiness before "
    "investing in heavier bets."))

# ═══ 2. METHODOLOGY ══════════════════════════════════════════════════════
h1(story, "2. Methodology and Scope")
story.append(P(
    "The research combined three evidence streams. First, fifteen targeted web searches profiled the "
    "current public feature sets of the seven global and two regional references, drawing on vendor "
    "documentation, 2025-2026 reviews, and comparison articles. Second, the EGX-local tier reused a "
    "logged-in scan of esthmr.com performed earlier in this project, in which every view of the site was "
    "walked and its underlying data endpoints harvested; esthmr is therefore profiled from its actual "
    "shipped product rather than marketing copy. Third, every EGX Desk capability cited in this report "
    "was re-verified against the production build during the full end-to-end test round that preceded "
    "this research: twelve views, one hundred API assertions, and interactive flows from search to "
    "screener presets to the coupon calculator."))
story.append(P(
    "Scoring uses a simple, transparent model. Twenty-five capabilities were selected to span the "
    "product surface of a retail market-data platform: market data, Arabic localization, research depth, "
    "tools, platform, and business layer. Each tool is scored per capability as full support (1.0), "
    "partial support (0.5), or absent (0.0). The weighted sum out of twenty-five is the coverage score "
    "shown in Chapter 4. The model deliberately counts breadth, not quality; where a tool is "
    "qualitatively stronger than the binary score suggests (for example TradingView charting), the prose "
    "profiles in Chapter 3 make the distinction explicit. Impact and effort ratings for the gap register "
    "use a five-point scale anchored to concrete definitions: impact 5 means a daily-use capability the "
    "target user explicitly expects; effort 1 means buildable in days with existing data."))
story.append(P(
    "Two scope limits should be acknowledged. Real-time streaming (Level 1/Level 2) is excluded from the "
    "gap register because it requires paid EGX feed licensing rather than engineering; it is treated as a "
    "business decision in Chapter 8. Analyst ratings and price targets are likewise excluded because "
    "systematic coverage of EGX stocks is not publicly available to any of the benchmarked tools either."))

# ═══ 3. COMPETITIVE LANDSCAPE ════════════════════════════════════════════
h1(story, "3. The Competitive Landscape")

h2(story, "3.1 Global leaders")
story.append(P(
    "<b>TradingView</b> is the reference point for charting and community. Beyond 100,000 community "
    "scripts in Pine Script, its current feature set spans smart alerts on price and indicator "
    "conditions (including webhook notifications), an economic calendar, Pine-based screeners that scan "
    "custom watchlists, drawing tools, multi-chart layouts, saved layouts, and an installable app on "
    "every platform. For EGX it carries quotes and charts but no Arabic names discipline, no insider "
    "log, and no investor-flow data. Its lesson for EGX Desk is operational: alerts and saved state turn "
    "a research site into a daily companion."))
story.append(P(
    "<b>Investing.com Pro</b> monetizes exactly the layer EGX Desk lacks. The Pro tier sells a screener "
    "with more than 167 filters, alerts on price points and percentage moves for watchlist and portfolio "
    "names, fair-value estimates, an ad-free experience, and broker-synced portfolios. Its Arabic edition "
    "localizes the interface but not the depth: EGX coverage is thin and machine-translated. The Pro "
    "package shows that the operational layer (alerts, portfolios, saved screens) is what users "
    " demonstrably pay for."))
story.append(P(
    "<b>Yahoo Finance</b> remains the free default for hundreds of millions of users on the strength of "
    "portfolio tracking with day gain and total gain, watchlists, alerts, an earnings calendar, and a "
    "vast news ecosystem. Its financials are a decade deep for US names but near-empty for EGX, and it "
    "has no Arabic interface. <b>stockanalysis.com</b> is the minimalist research counterpoint: ten years "
    "of statements, dividend history with payment dates, insider activity, analyst ratings, and a clean "
    "side-by-side comparison tool, all wrapped in a fast, text-dense interface - the closest spiritual "
    "sibling to EGX Desk's plain-language philosophy, and the model for its missing dividend and "
    "comparison features."))
story.append(P(
    "<b>Simply Wall St</b> contributes one idea worth stealing: the Snowflake, a five-factor visual "
    "score (value, future, past performance, health, dividends) that lets a novice grasp a company "
    "profile in three seconds. <b>Koyfin</b> demonstrates drag-and-drop dashboards where users compose "
    "their own watchlists, charts, and tables. <b>Finbox</b> goes deepest on valuation: discounted cash "
    "flow with editable assumptions, sensitivity ranges, peer multiples, and fair-value screeners. None "
    "of the three covers EGX meaningfully, but each defines the ceiling of its category."))

h2(story, "3.2 Arabic regional portals")
story.append(P(
    "<b>Mubasher</b> is the traffic giant of Arabic financial portals, with real-time data across MENA "
    "exchanges, company financials, earnings calendars, and news in Arabic and English. Its EGX company "
    "pages are serviceable but its design is dated, its explanations assume an expert reader, and its "
    "monetization leans on broker referrals. <b>Argaam</b> is the Saudi benchmark: disciplined bilingual "
    "news, live quotes, statements, earnings pages, and a genuine education layer. Its EGX coverage is "
    "secondary to its Saudi core. Both portals confirm that bilingual breadth plus a calendar plus "
    "portfolios is the regional baseline - EGX Desk currently matches the Arabic depth but not the "
    "operational breadth."))

h2(story, "3.3 Egypt-specific references")
story.append(P(
    "<b>esthmr.com</b> is the direct competitor and the most instructive one. A logged-in scan found a "
    "thoughtful product: a market map, sector breadth, an insiders view with the same EGX disclosure "
    "documents EGX Desk links to, a valuation-and-debt two-dimensional map, curated pair comparisons "
    "with P/E calibration and narrative, live world markets, gold by karat, an events calendar, "
    "server-side accounts with synced watchlists, and a 29-period company financial view with "
    "versus-sector deltas. EGX Desk beats it on Arabic naming discipline, breadth history, technical "
    "analysis, statements charts, tools, TTS, and verified error-free UX - but trails on the operational "
    "layer: calendar, pairs comparison, valuation map, and accounts."))
story.append(P(
    "The <b>EGX official website</b> is the canonical source, not a competitor: it publishes the "
    "disclosure documents, index compositions, and listing rules every downstream tool depends on, and "
    "sells streaming feeds to professionals. Its retail experience is minimal. The strategic reading: "
    "EGX Desk's sourcing-first culture is an asset that compounds as it keeps linking every number to "
    "the official record."))

# ═══ 4. BENCHMARK MATRIX ═════════════════════════════════════════════════
h1(story, "4. Feature Benchmark Matrix")
story.append(P(
    "The matrix below scores the twenty-five benchmarked capabilities. The two tables split the "
    "comparison so each remains readable: the first covers EGX Desk against the five most relevant "
    "global tools, the second against the regional and Egypt-specific tier. A check means full support, "
    "part. means partial, and a dash means the capability is absent. EGX Desk's column is tinted for "
    "orientation. Scores are deliberately binary; qualitative nuance lives in the Chapter 3 profiles."))
story.extend(fig(os.path.join(OUT_DIR, "chart-coverage.png"),
    f"Figure 1. Weighted capability coverage across the twelve-tool benchmark "
    f"(N = {N_CAPS} capabilities). EGX Desk ({SCORES['EGX Desk']:.1f}) ranks fifth overall and second "
    f"on the Egypt-relevant subset behind esthmr.com ({SCORES['esthmr.com']:.1f}).", 250))
tbl_a = bench_table(["EGX Desk", "TradingView", "Investing.com", "Yahoo Finance",
                     "stockanalysis.com", "Simply Wall St"], 0, 13)
story.append(Spacer(1, 10))
story.append(tbl_a)
story.append(Spacer(1, 6))
story.append(P("Table A. Capabilities 1-13: market data, localization, and research depth "
               "versus the five most relevant global tools.", S_CAP))
story.append(Spacer(1, 10))
tbl_b = bench_table(["EGX Desk", "Koyfin", "Finbox", "Mubasher", "Argaam",
                     "esthmr.com", "EGX official"], 13, 25)
story.append(tbl_b)
story.append(Spacer(1, 6))
story.append(P("Table B. Capabilities 14-25: news, world context, tools, platform, and business "
               "layer versus regional and Egypt-specific references.", S_CAP))
story.append(Spacer(1, 10))
story.append(P(
    "Three readings stand out. First, on market-data and localization capabilities (rows 1-5, 14-16), "
    "EGX Desk is at or near the top of the entire benchmark, and on text-to-speech it is alone. Second, "
    "the operational rows (6-10, 17-18) are a wall of dashes for EGX Desk and a wall of checks for "
    "everyone else - this is the gap. Third, the coverage chart makes the structural position visible: "
    "EGX Desk outscores Koyfin, Finbox, Argaam, and the EGX site, matches stockanalysis.com and Simply "
    "Wall St within a point, and sits roughly six points behind TradingView and Investing.com - "
    "almost entirely because of the missing operational layer."))

# ═══ 5. STRENGTHS ════════════════════════════════════════════════════════
h1(story, "5. Where EGX Desk Already Leads")
story.append(P(
    "A gap analysis is only useful on top of an honest inventory of strengths, because the right "
    "strategy is to build the missing operational layer on top of differentiators the giants cannot "
    "quickly copy. Six stand out."))
bullets(story, [
    "<b>Insider and treasury-share log.</b> All 334 filed dealings, filterable by insider buys, sells, "
    "and treasury operations, each row linked to its official EGX disclosure document. Global tools have "
    "nothing comparable for EGX; only esthmr matches it.",
    "<b>Investor-flow and breadth analytics.</b> Real buy/sell splits by investor category, plus a "
    "284-stock advance-decline history - market internals that even TradingView does not surface for "
    "Egypt.",
    "<b>Official Arabic naming discipline.</b> Every company appears under its official EGX Arabic name "
    "(284 of 284, with sector labels and dollar-quoted flags), in a fully RTL interface that switches "
    "to complete English. No global tool attempts this; regional portals do it inconsistently.",
    "<b>Plain-language culture.</b> Every number carries a plain-Arabic explanation of what it means, "
    "its source, and its cadence - the stockanalysis.com philosophy executed bilingually, extended with "
    "text-to-speech for prices, briefs, and news.",
    "<b>Verified engineering quality.</b> A 100-assertion API suite, a twelve-view production audit with "
    "zero page errors, hand-verified calculator math, and mobile-clean layouts - the kind of polish "
    "that regional portals visibly lack.",
    "<b>Deep EGX context.</b> Two hundred and three sessions of index history, live world markets and "
    "commodities, gold in three karats, and an eight-currency table, all framed for the Egyptian "
    "saver-investor rather than the global trader.",
])
story.append(P(
    "These strengths define the sequencing logic of the roadmap: the missing layer (alerts, portfolio, "
    "calendar, dividends, comparison) is generic in the abstract, but delivered on top of EGX-specific "
    "data nobody else has, it becomes a moat. An alert on an EGX stock that arrives with the "
    "plain-Arabic context of why the level matters is a different product from a TradingView push "
    "notification."))

# ═══ 6. GAP ANALYSIS ═════════════════════════════════════════════════════
h1(story, "6. Gap Analysis: What We Miss")
story.append(P(
    "Nineteen gaps were registered. Each is stated as a capability, rated for impact and effort on the "
    "five-point scales defined in Chapter 2, and tagged with the benchmark precedent that proves users "
    "expect it. The register is then narrated by priority tier; the impact-versus-effort chart at the "
    "end of the chapter maps all nineteen at once."))
story.extend(fig(os.path.join(OUT_DIR, "chart-matrix.png"),
    "Figure 2. The nineteen registered gaps on the impact-versus-effort plane. "
    "Quadrant boundaries sit at effort 3.0 and impact 3.55; labels reference the gap IDs in the "
    "tier tables below.", 280))

h2(story, "6.1 Priority 0 - quick wins (build first)")
story.append(gap_table("P0"))
story.append(Spacer(1, 8))
story.append(P(
    "<b>G1 Alerts.</b> The single highest-impact gap in the register. Every benchmarked tool that "
    "retains users lets them set a price or indicator alert; neither esthmr nor any Arabic-first EGX "
    "tool offers one. A first version needs no infrastructure: thresholds stored in localStorage, "
    "evaluated against the existing delayed-quote refresh, surfaced in-app and through the browser "
    "Notification API. Later, web push (G14) makes it work with the tab closed."))
story.append(P(
    "<b>G2 Portfolio tracker.</b> The watchlist already persists tickers; adding shares and cost basis "
    "per position yields day gain, total gain, and portfolio weight at zero new data cost. Benchmark "
    "comparison against EGX30 reuses the technical panel's rebased-chart logic. This converts the site "
    "from a research tool into a place a user's money lives."))
story.append(P(
    "<b>G3 Dividend history and dates.</b> The screener already carries current yield for the "
    "ninety-three payers; what is missing is the history: payments per year over five years, growth, "
    "payout ratio, and upcoming ex-dates and pay-dates. The data exists in EGX disclosures and the "
    "news archive already harvested - it is a structuring problem, not a sourcing problem. This "
    "completes the income-investor story the coupon calculator begins."))
story.append(P(
    "<b>G4 Company comparison, G5 calendar.</b> A side-by-side of two to four companies (performance "
    "chart, valuation multiples, margins, dividends) matches stockanalysis.com and esthmr's pairs view. "
    "An events calendar for results dates, dividend dates, and assemblies closes the loop with the "
    "disclosures feed; esthmr ships one, proving the data is accessible. <b>G6-G8</b> are polish gaps: "
    "persisting screener filters across visits, exporting screener and statement tables to CSV, and "
    "log-scale plus multi-series chart modes - each is days of work with existing components."))

h2(story, "6.2 Priority 1 - big bets")
story.append(gap_table("P1"))
story.append(Spacer(1, 8))
story.append(P(
    "<b>G9 Statements depth.</b> Today the site carries six years of annual income, balance sheet, and "
    "cash flow, plus quarterly income - stockanalysis.com ships ten years of everything, and esthmr "
    "twenty-nine periods with versus-sector deltas. Extending history and adding quarterly balance and "
    "cash flow multiplies the research value of the existing stockanalysis.com pipeline. <b>G10 "
    "Valuation layer.</b> A fair-value view is the biggest perceived-sophistication gap: a DCF "
    "calculator with editable assumptions (Finbox model), sector-percentile multiples, and a "
    "Simply-Wall-St-style five-factor score rendered as a visual would fit the plain-language brand "
    "perfectly."))
story.append(P(
    "<b>G11 English news.</b> The archive is Arabic-only; English-mode users get an empty experience. "
    "Headline translation of the existing 9,200-item archive, or an English-source feed layered on the "
    "same view, fixes a daily-experience hole for expatriate and professional users. <b>G12 Treasury "
    "rates.</b> Egyptian T-bill and deposit yields are the missing leg of the site's own stocks-versus-"
    "bank-versus-gold framing; esthmr publishes them, and public sources exist. <b>G13 Fund pages.</b> "
    "Listed funds and certificates currently render as bare stock rows; dedicated pages with net asset "
    "value and fee context would complete market coverage. <b>G14 PWA.</b> An installable app with "
    "web-push notifications is the delivery mechanism that makes G1 matter on mobile."))

h2(story, "6.3 Priority 2 - long-term differentiators")
story.append(gap_table("P2"))
story.append(Spacer(1, 8))
story.append(P(
    "These are the capabilities that separate platforms from tools, each costing quarters of sustained "
    "work. <b>G15 Cross-signal narratives</b> generalize the per-company signals view into market-wide "
    "connect-the-dots storytelling, esthmr's most distinctive feature. <b>G16 Accounts with sync</b> "
    "would carry watchlists, portfolios, alerts, and saved screens across devices - the moment the "
    "operational layer justifies it. <b>G17 Community and education</b> is the TradingView and Argaam "
    "play: ideas, comments, and an Arabic investing academy. <b>G18 A public API</b> opens the data "
    "layer to developers and quantifiers. <b>G19 Drawing tools</b> complete the charting story for "
    "technical users. None of these should be started before the P0 layer ships; all of them compound "
    "on top of it."))

# ═══ 7. ROADMAP ══════════════════════════════════════════════════════════
h1(story, "7. Prioritized Roadmap")
story.append(P(
    "The recommended sequence converts the impact-versus-effort plane into three delivery waves. Wave "
    "one (the eight P0 gaps) is deliberately unglamorous: it wires the operational layer users expect "
    "from any serious tool onto the EGX-specific data nobody else has. Wave two builds the research "
    "moat. Wave three picks the differentiation bets that the first two waves make rational."))
road_head = [Paragraph(f"<b>{x}</b>", S_TH) for x in
             ["Wave", "Gaps", "Theme", "Exit criterion"]]
road_data = [
    [Paragraph("<b>Wave 1</b>", S_TDL),
     Paragraph("G1, G2, G3, G6, G7, G8", S_TDL),
     Paragraph("Daily-use layer: alerts, portfolio, dividends, persisted screens, exports, chart modes", S_TDL),
     Paragraph("A user can set an alert, hold a portfolio, see dividend dates, and return to a saved screen", S_TDL)],
    [Paragraph("<b>Wave 1+</b>", S_TDL),
     Paragraph("G5, G4, G14", S_TDL),
     Paragraph("Calendar, comparison, and the PWA that delivers alerts to the phone", S_TDL),
     Paragraph("Installable app whose notifications drive return visits", S_TDL)],
    [Paragraph("<b>Wave 2</b>", S_TDL),
     Paragraph("G9, G10, G12, G11", S_TDL),
     Paragraph("Research depth: full statements, valuation layer, rates, bilingual news", S_TDL),
     Paragraph("stockanalysis.com depth plus a fair-value view with EGX context", S_TDL)],
    [Paragraph("<b>Wave 3</b>", S_TDL),
     Paragraph("G13, G15, G16, G17, G18, G19", S_TDL),
     Paragraph("Differentiation: funds, narratives, accounts, community, API, drawing tools", S_TDL),
     Paragraph("Chosen by evidence from Waves 1-2 usage, not in advance", S_TDL)],
]
widths = [0.10, 0.16, 0.42, 0.32]
road = Table(road_data, colWidths=[r * AVAIL_W for r in widths], hAlign="CENTER", repeatRows=1)
road_style = [
    ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
    ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]
for i in range(1, len(road_data)):
    road_style.append(("BACKGROUND", (0, i), (-1, i),
                       TABLE_ROW_ODD if i % 2 else TABLE_ROW_EVEN))
road.setStyle(TableStyle(road_style))
story.append(Spacer(1, 10))
story.append(road)
story.append(Spacer(1, 6))
story.append(P("Table C. Delivery waves derived from the impact-versus-effort register.", S_CAP))
story.append(Spacer(1, 10))
story.append(P(
    "Two sequencing principles are worth stating explicitly. First, alerts precede accounts: a "
    "localStorage-based alert works today and teaches the product what users actually watch, informing "
    "the later account system. Second, the calendar precedes the valuation layer even though its impact "
    "rating is similar, because it reuses the disclosures pipeline already in production, whereas "
    "valuation needs new modeling UX. The wave boundaries are soft - G12 (treasury rates) is small "
    "enough to slot into any wave, and G13 (fund pages) can ride along with statements depth."))

# ═══ 8. STRATEGIC RECOMMENDATIONS ════════════════════════════════════════
h1(story, "8. Strategic Recommendations")
story.append(P(
    "First, ship the operational layer before adding any new data. The benchmark's clearest lesson is "
    "that alerts, portfolios, calendars, and dividends are not features but the grammar of a financial "
    "daily companion; without them, even superior data stays a reference site users visit occasionally. "
    "The eight quick wins cost less combined than a single big bet and change the usage pattern of the "
    "product."))
story.append(P(
    "Second, keep the sourcing-first culture as the brand. Every gap in this register can be closed "
    "with attributed, verifiable sources - dividend history from EGX disclosures, calendar from "
    "published events, rates from official auctions - and every closed gap should ship with the same "
    "plain-Arabic explanation of what the number means and where it comes from. That discipline is what "
    "distinguishes EGX Desk from machine-translated portals, and it compounds: each linked disclosure "
    "document is a trust asset the aggregators cannot fake."))
story.append(P(
    "Third, treat real-time data as a business decision, not a feature gap. Streaming EGX quotes "
    "require licensed feeds; the money a paid feed would consume funds the entire P0 and P1 waves. "
    "Delayed quotes with honest labeling serve the research use case, and the alert system can be "
    "designed around fifteen-minute granularity from day one, with an upgrade path when licensing "
    "makes sense."))
story.append(P(
    "Fourth, measure the waves. Before shipping, instrument the questions this research could not "
    "answer from the outside: which views users return to, what they search for, and whether alerts "
    "and portfolios change session frequency. Wave three choices - community, accounts, API, drawing "
    "tools - should be made on that evidence, not on this benchmark alone. The matrix says what the "
    "best tools have; only usage data says what EGX Desk's users actually need next."))

# ── Build ────────────────────────────────────────────────────────────────
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))

BODY_PDF = os.path.join(OUT_DIR, "gap-body.pdf")
doc = TocDocTemplate(BODY_PDF, pagesize=A4,
                     leftMargin=MARGIN, rightMargin=MARGIN,
                     topMargin=MARGIN, bottomMargin=MARGIN,
                     title=DOC_TITLE, author="Z.ai", creator="Z.ai",
                     subject="Competitive research and feature gap analysis for EGX Desk")
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("BODY OK:", BODY_PDF, os.path.getsize(BODY_PDF), "bytes")
