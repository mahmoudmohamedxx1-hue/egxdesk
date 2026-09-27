#!/usr/bin/env python3
"""Merge cover + body into the final report PDF (A4-normalized)."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    w, h = float(page.mediabox.width), float(page.mediabox.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

OUT = "/home/z/my-project/download/EGX-Desk-Competitive-Research-Gap-Analysis.pdf"
writer = PdfWriter()
writer.add_page(normalize(PdfReader("/home/z/my-project/scripts/research/cover.pdf").pages[0]))
for p in PdfReader("/home/z/my-project/scripts/research/gap-body.pdf").pages:
    writer.add_page(normalize(p))
writer.add_metadata({
    "/Title": "EGX Desk - Competitive Research & Feature Gap Analysis",
    "/Author": "Z.ai", "/Creator": "Z.ai",
    "/Subject": "Competitive benchmark of 12 market-data platforms and feature gap roadmap for EGX Desk",
})
with open(OUT, "wb") as f:
    writer.write(f)
print("MERGED:", OUT, len(writer.pages), "pages")
