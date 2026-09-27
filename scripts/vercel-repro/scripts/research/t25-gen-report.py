#!/usr/bin/env python3
"""T25 — EGX Desk Worldwide Competitive Research & Feature Gap Analysis (2nd ed).
ReportLab body (TOC + 10 chapters) + HTML/Playwright cover merged via pypdf.
Follows briefs/report.md: TocDocTemplate.multiBuild, cascade palette, Paragraph
table cells, safe KeepTogether, CondPageBreak orphan guards, install_font_fallback."""
import os
import sys
import hashlib

SKILL = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(SKILL, "scripts"))
OUT_DIR = "/home/z/my-project/scripts/research"
DL_DIR = "/home/z/my-project/download"
BODY_PDF = f"{OUT_DIR}/t25-body.pdf"
COVER_PDF = f"{OUT_DIR}/t25-cover.pdf"
FINAL_PDF = f"{DL_DIR}/EGX-Desk-Worldwide-Competitive-Research-Gap-Analysis-v2.pdf"

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
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
from PIL import Image as PILImage

# ── fonts (allowed set only) ──────────────────────────────────────────────
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

from pdf import install_font_fallback  # noqa: E402
install_font_fallback()

# ── cascade palette (pdf.py palette.cascade, seed 7) ──────────────────────
PAGE_BG       = colors.HexColor('#f1f0ef')
SECTION_BG    = colors.HexColor('#f2f1f0')
CARD_BG       = colors.HexColor('#e8e7e4')
TABLE_STRIPE  = colors.HexColor('#eeedeb')
HEADER_FILL   = colors.HexColor('#504933')
COVER_BLOCK   = colors.HexColor('#867b5a')
BORDER        = colors.HexColor('#cfcab8')
ICON          = colors.HexColor('#8c7e52')
ACCENT        = colors.HexColor('#87702a')
ACCENT_2      = colors.HexColor('#3a95b4')
TEXT_PRIMARY  = colors.HexColor('#1c1c1a')
TEXT_MUTED    = colors.HexColor('#78766f')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ── geometry ───────────────────────────────────────────────────────────────
MARGIN = 0.9 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN
MAX_KEEP_HEIGHT = PAGE_H * 0.4
H1_ORPHAN_THRESHOLD = AVAIL_H * 0.25

DOC_TITLE = "EGX Desk — Worldwide Competitive Research & Feature Gap Analysis"
DOC_AUTHOR = "Z.ai Research"

# ── styles ─────────────────────────────────────────────────────────────────
S = {}
S["body"] = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=16.5,
                           alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=9)
S["h1"] = ParagraphStyle("H1", fontName="FreeSerif", fontSize=18, leading=23,
                         textColor=HEADER_FILL, spaceBefore=18, spaceAfter=4)
S["h2"] = ParagraphStyle("H2", fontName="FreeSerif", fontSize=13.5, leading=18,
                         textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=6)
S["bullet"] = ParagraphStyle("Bullet", fontName="FreeSerif", fontSize=10.5, leading=16,
                             alignment=TA_LEFT, textColor=TEXT_PRIMARY, leftIndent=14,
                             bulletIndent=2, spaceAfter=7)
S["caption"] = ParagraphStyle("Caption", fontName="FreeSerif-Italic", fontSize=8.5, leading=12,
                              alignment=TA_CENTER, textColor=TEXT_MUTED, spaceBefore=3, spaceAfter=6)
S["note"] = ParagraphStyle("Note", fontName="FreeSerif-Italic", fontSize=8, leading=11.5,
                           alignment=TA_LEFT, textColor=TEXT_MUTED, spaceAfter=6)
S["th"] = ParagraphStyle("TH", fontName="FreeSerif", fontSize=8.6, leading=11.5,
                         alignment=TA_CENTER, textColor=colors.white)
S["td"] = ParagraphStyle("TD", fontName="FreeSerif", fontSize=8.6, leading=11.5,
                         alignment=TA_LEFT, textColor=TEXT_PRIMARY)
S["tdc"] = ParagraphStyle("TDC", parent=S["td"], alignment=TA_CENTER)
S["stat"] = ParagraphStyle("Stat", fontName="FreeSerif", fontSize=19, leading=23,
                           alignment=TA_CENTER, textColor=ACCENT)
S["statlabel"] = ParagraphStyle("StatLabel", fontName="FreeSerif", fontSize=8.3, leading=11,
                                alignment=TA_CENTER, textColor=TEXT_MUTED)
S["quote"] = ParagraphStyle("Quote", fontName="FreeSerif-Italic", fontSize=10.5, leading=16,
                            leftIndent=24, textColor=TEXT_MUTED, spaceBefore=8, spaceAfter=8)
S["src"] = ParagraphStyle("Src", fontName="FreeSerif", fontSize=8.8, leading=12.6,
                          alignment=TA_LEFT, textColor=TEXT_PRIMARY,
                          leftIndent=24, firstLineIndent=-24, spaceAfter=5)
S["toc0"] = ParagraphStyle("TOC0", fontName="FreeSerif-Bold", fontSize=11.5, leading=17,
                           leftIndent=6, textColor=TEXT_PRIMARY)
S["toc1"] = ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=10, leading=15,
                           leftIndent=26, textColor=TEXT_MUTED)
S["toctitle"] = ParagraphStyle("TocTitle", fontName="FreeSerif", fontSize=17, leading=22,
                               textColor=HEADER_FILL, spaceAfter=12)

# ── doc template with TOC notify + header/footer ───────────────────────────
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            self.notify("TOCEntry", (level, text, self.page, key))


def on_page(canvas, doc):
    canvas.saveState()
    # header: doc title + accent rule
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, DOC_TITLE)
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    # footer: author left, page number right, light rule
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 0.62 * inch, PAGE_W - MARGIN, 0.62 * inch)
    canvas.setFont("FreeSerif", 7.5)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(MARGIN, 0.45 * inch, DOC_AUTHOR)
    canvas.drawRightString(PAGE_W - MARGIN, 0.45 * inch, str(doc.page))
    canvas.restoreState()


def add_heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def safe_keep_together(elements):
    total_h = 0
    for el in elements:
        w, h = el.wrap(AVAIL_W, PAGE_H)
        total_h += h
    if total_h <= MAX_KEEP_HEIGHT:
        return [KeepTogether(elements)]
    elif len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)


def embed_image(path, max_width=None, max_height=None):
    if max_width is None:
        max_width = AVAIL_W
    if max_height is None:
        max_height = PAGE_H * 0.35
    pil = PILImage.open(path)
    ow, oh = pil.size
    ratio = min(max_width / ow if ow > max_width else 1.0,
                max_height / oh if oh > max_height else 1.0,
                max_width / ow)  # always scale down to width
    return Image(path, width=ow * ratio, height=oh * ratio)


def make_table(head, rows, ratios, note=None):
    assert abs(sum(ratios) - 1.0) < 0.02, f"ratios sum {sum(ratios)}"
    col_widths = [r * AVAIL_W for r in ratios]
    assert sum(col_widths) <= AVAIL_W + 0.5
    data = [[Paragraph(f"<b>{h}</b>", S["th"]) for h in head]]
    n_center = 0
    if rows and len(rows[0]) >= 9:  # matrix tables: center all but col 0
        n_center = len(head) - 1
    for r in rows:
        row = []
        for i, cell in enumerate(r):
            st = S["tdc"] if (0 < i <= n_center) else S["td"]
            row.append(Paragraph(str(cell), st))
        data.append(row)
    t = Table(data, colWidths=col_widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i), TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD))
    t.setStyle(TableStyle(style))
    return t


def make_callouts(items):
    cells = []
    for big, label in items:
        inner = Table(
            [[Paragraph(f"<b>{big}</b>", S["stat"])], [Paragraph(label, S["statlabel"])]],
            colWidths=[AVAIL_W / len(items) - 14],
        )
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 0.8, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 9),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
            ("TOPPADDING", (0, 1), (-1, 1), 2),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        cells.append(inner)
    outer = Table([cells], colWidths=[AVAIL_W / len(items)] * len(items), hAlign="CENTER")
    outer.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return outer


# ── build story from content module ────────────────────────────────────────
sys.path.insert(0, OUT_DIR)
from t25_report_content import CONTENT  # noqa: E402

story = []
toc = TableOfContents()
toc.levelStyles = [S["toc0"], S["toc1"]]
story.append(Paragraph("<b>Table of Contents</b>", S["toctitle"]))
story.append(toc)
story.append(PageBreak())

prev_was_h1 = False
for kind, payload in CONTENT:
    if kind == "h1":
        story.append(CondPageBreak(H1_ORPHAN_THRESHOLD))
        h = add_heading(payload, S["h1"], level=0)
        rule = HRFlowable(width="100%", color=ACCENT, thickness=1.1, spaceBefore=0, spaceAfter=10)
        story.extend(safe_keep_together([h, rule]))
        prev_was_h1 = True
    elif kind == "h2":
        story.append(CondPageBreak(AVAIL_H * 0.12))
        story.append(add_heading(payload, S["h2"], level=1))
        prev_was_h1 = False
    elif kind == "p":
        story.append(Paragraph(payload, S["body"]))
        prev_was_h1 = False
    elif kind == "bullets":
        for b in payload:
            story.append(Paragraph(b, S["bullet"], bulletText="\u2022"))
        story.append(Spacer(1, 4))
    elif kind == "callouts":
        story.append(Spacer(1, 8))
        story.append(make_callouts(payload))
        story.append(Spacer(1, 14))
    elif kind == "table":
        story.append(Spacer(1, 10))
        t = make_table(payload["head"], payload["rows"], payload["ratios"])
        cap = Paragraph(payload["caption"], S["caption"])
        if len(payload["rows"]) <= 15:
            story.extend(safe_keep_together([t, cap]))
        else:
            story.append(t)
            story.append(cap)
        if payload.get("note"):
            story.append(Paragraph("Note: " + payload["note"], S["note"]))
        story.append(Spacer(1, 12))
    elif kind == "img":
        path, caption = payload
        story.append(Spacer(1, 14))
        img = embed_image(path, max_width=AVAIL_W, max_height=300)
        cap = Paragraph(caption, S["caption"])
        story.extend(safe_keep_together([img, cap]))
        story.append(Spacer(1, 14))
    elif kind == "quote":
        story.append(HRFlowable(width="30%", color=ACCENT, thickness=2, hAlign="LEFT",
                                spaceBefore=6, spaceAfter=4))
        story.append(Paragraph(payload, S["quote"]))
        story.append(HRFlowable(width="30%", color=ACCENT, thickness=2, hAlign="LEFT",
                                spaceBefore=4, spaceAfter=6))
    elif kind == "srcs":
        for i, s_item in enumerate(payload, 1):
            story.append(Paragraph(f"{i}.  {s_item}", S["src"]))

doc = TocDocTemplate(
    BODY_PDF, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
    title=DOC_TITLE, author=DOC_AUTHOR, creator="Z.ai",
    subject="Worldwide competitive research and feature gap analysis for EGX Desk, September 2026",
)
doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
print("body built:", BODY_PDF)

# ── merge cover as page 0 ─────────────────────────────────────────────────
from pypdf import PdfReader, PdfWriter  # noqa: E402

A4_W, A4_H = 595.28, 841.89

def normalize_page_to_a4(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.3 or abs(h - A4_H) > 0.3:
        page.scale_to(A4_W, A4_H)
    return page

writer = PdfWriter()
writer.add_page(normalize_page_to_a4(PdfReader(COVER_PDF).pages[0]))
for page in PdfReader(BODY_PDF).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    "/Title": DOC_TITLE,
    "/Author": "Z.ai",
    "/Creator": "Z.ai",
    "/Subject": "Worldwide competitive research and feature gap analysis for EGX Desk, September 2026",
})
with open(FINAL_PDF, "wb") as f:
    writer.write(f)
print("final:", FINAL_PDF, os.path.getsize(FINAL_PDF), "bytes,", len(writer.pages), "pages")
