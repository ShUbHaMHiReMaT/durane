"""Downloadable A4 product catalogue (PDF) built from the website content and live product table."""
import hashlib
import io
import json
import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, Image, KeepTogether, NextPageTemplate, PageBreak,
                                PageTemplate, Paragraph, Spacer, Table, TableStyle)

import catalog
from pdfgen import BOLD, FONT

IMG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "catalog")
RED = colors.HexColor("#D71920")
INK = colors.HexColor("#121417")
MUTED = colors.HexColor("#5B6270")
LINE = colors.HexColor("#E4E6EA")
TINT = colors.HexColor("#F6F7F9")
PW, PH = A4
M = 16 * mm
CW = PW - 2 * M

BODY = ParagraphStyle("body", fontName=FONT, fontSize=9.5, leading=14, textColor=colors.HexColor("#2B2F36"), spaceAfter=6)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=8, leading=11, textColor=MUTED)
H1 = ParagraphStyle("h1", fontName=BOLD, fontSize=20, leading=24, textColor=INK, spaceAfter=4)
H2 = ParagraphStyle("h2", fontName=BOLD, fontSize=12, leading=16, textColor=INK, spaceBefore=6, spaceAfter=4)
EYEBROW = ParagraphStyle("eb", fontName=BOLD, fontSize=8, leading=10, textColor=RED)
TICK = ParagraphStyle("tick", parent=BODY, leftIndent=10, bulletIndent=0, spaceAfter=2)
TH = ParagraphStyle("th", fontName=BOLD, fontSize=8.5, leading=10, textColor=colors.white)
TD = ParagraphStyle("td", fontName=FONT, fontSize=8.5, leading=10.5)
TDB = ParagraphStyle("tdb", parent=TD, fontName=BOLD)

_CACHE = {}


def esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def img(name, width, height=None):
    path = os.path.join(IMG_DIR, name)
    im = Image(path)
    ratio = im.imageHeight / float(im.imageWidth)
    im.drawWidth = width
    im.drawHeight = height or width * ratio
    return im


def cover(c, doc):
    co = catalog.COMPANY
    c.saveState()
    c.setFillColor(INK)
    c.rect(0, 0, PW, PH, fill=1, stroke=0)
    c.drawImage(os.path.join(IMG_DIR, catalog.HERO_IMAGE), 0, PH * 0.38, PW, PH * 0.62, preserveAspectRatio=False)
    c.setFillColor(colors.Color(0.07, 0.08, 0.09, alpha=0.35))
    c.rect(0, PH * 0.38, PW, PH * 0.62, fill=1, stroke=0)
    c.setFillColor(RED)
    c.rect(0, PH * 0.38 - 6 * mm, PW, 6 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.roundRect(M - 2 * mm, PH - M - 32 * mm, 34 * mm, 34 * mm, 3 * mm, fill=1, stroke=0)
    c.drawImage(os.path.join(IMG_DIR, catalog.LOGO), M, PH - M - 30 * mm, 30 * mm, 30 * mm, mask="auto",
                preserveAspectRatio=True)
    c.setFillColor(colors.white)
    c.setFont(BOLD, 11)
    c.drawString(M, PH * 0.38 - 22 * mm, "NEU-TECH  |  TYRE & TUBE REPAIR PRODUCTS")
    c.setFont(BOLD, 40)
    c.drawString(M, PH * 0.38 - 42 * mm, "Product Catalogue")
    c.setFont(FONT, 13)
    c.setFillColor(colors.HexColor("#C9CDD4"))
    c.drawString(M, PH * 0.38 - 52 * mm, f"Bias, radial, plug patches, chemicals and tools  ·  {date.today().year}")
    c.setFillColor(colors.white)
    c.setFont(BOLD, 11)
    c.drawString(M, 30 * mm, co["name"].upper())
    c.setFont(FONT, 9.5)
    c.setFillColor(colors.HexColor("#C9CDD4"))
    c.drawString(M, 24 * mm, ", ".join(co["address_lines"]))
    c.drawString(M, 18 * mm, f"Phone / WhatsApp: {co['phone_display']}    E-mail: {co['email']}")
    c.restoreState()


def inner(c, doc):
    c.saveState()
    c.setFillColor(RED)
    c.rect(M, PH - 12 * mm, 12 * mm, 1.2 * mm, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont(BOLD, 8.5)
    c.drawString(M + 15 * mm, PH - 12.4 * mm, "NEU-TECH  ·  Product Catalogue")
    c.setFont(FONT, 8)
    c.setFillColor(MUTED)
    c.drawRightString(PW - M, PH - 12.4 * mm, "Omkar Industries, Belagavi")
    c.setStrokeColor(LINE)
    c.line(M, 14 * mm, PW - M, 14 * mm)
    co = catalog.COMPANY
    c.drawString(M, 9.5 * mm, f"{co['phone_display']}  ·  {co['email']}")
    c.drawRightString(PW - M, 9.5 * mm, f"Page {doc.page}")
    c.restoreState()


def family_block(n, fam, rows):
    out = []
    head = Table([[Paragraph(f"{n:02d}", ParagraphStyle("no", fontName=BOLD, fontSize=22, leading=24, textColor=RED)),
                   [Paragraph(esc(fam["short"]).upper(), EYEBROW), Paragraph(esc(fam["title"]), H1)]]],
                 colWidths=[16 * mm, CW - 16 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("LINEBELOW", (0, 0), (-1, 0), 1, LINE), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    out += [head, Spacer(1, 4 * mm)]

    text = [Paragraph(esc(p), BODY) for p in fam["text"]]
    text += [Paragraph("Key features", H2)] + [Paragraph(esc(p), TICK, bulletText="•") for p in fam["points"]]
    text += [Paragraph("Used on: " + esc(", ".join(fam["uses"])), SMALL)]
    pics = [img(name, 74 * mm, 50 * mm) for name in fam["images"][:2]]
    pic_col = Table([[p] for p in pics], colWidths=[76 * mm],
                    style=[("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)])
    body = Table([[text, pic_col]], colWidths=[CW - 80 * mm, 80 * mm])
    body.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (0, 0), 0),
                              ("RIGHTPADDING", (0, 0), (0, 0), 8 * mm), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
    out += [body, Spacer(1, 4 * mm)]

    if rows:
        if fam["kind"] == "plug":
            head_cells = ["Product Code", "Product", "Plug Patch Size", "Injury Size", "Qty / Box"]
            data = [[Paragraph(h, TH) for h in head_cells]]
            data += [[Paragraph(esc(r["code"]), TD), Paragraph(esc(r["name"]), TDB), Paragraph(esc(r["size"]), TD),
                      Paragraph(esc(r["rating"]), TD), Paragraph(esc(r["qty"]), TD)] for r in rows]
            w = [26 * mm, 28 * mm, CW - 108 * mm, 34 * mm, 20 * mm]
        else:
            head_cells = ["Versa Cure Code", "Versa Cure Patch", "Chemical Cure Code", "Chemical Cure Patch",
                          "Size (mm)", "Ply Rating", "Qty / Box"]
            data = [[Paragraph(h, TH) for h in head_cells]]
            data += [[Paragraph(esc(r["code"]), TD), Paragraph(esc(r["name"]) + (" *" if r["crown"] else ""), TDB),
                      Paragraph(esc(r["chem_code"]), TD), Paragraph(esc(r["chem_name"]), TD), Paragraph(esc(r["size"]), TD),
                      Paragraph(esc(r["rating"]), TD), Paragraph(esc(r["qty"]), TD)] for r in rows]
            w = [24 * mm, 26 * mm, 24 * mm, 28 * mm, CW - 140 * mm, 18 * mm, 20 * mm]
        t = Table(data, colWidths=w, repeatRows=1)
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, TINT]),
                               ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        out.append(t)
        if any(r.get("crown") for r in rows):
            out += [Spacer(1, 2 * mm), Paragraph(esc(catalog.CROWN_NOTE), SMALL)]
    return out


def build():
    key = hashlib.md5(json.dumps([catalog.SPECS, catalog.FAMILIES, catalog.COMPANY], sort_keys=True, default=str).encode()).hexdigest()
    if key in _CACHE:
        return _CACHE[key]

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=M, rightMargin=M, topMargin=20 * mm, bottomMargin=20 * mm,
                          title="NEU-TECH Product Catalogue", author="Omkar Industries")
    frame = Frame(M, 20 * mm, CW, PH - 40 * mm, id="f")
    doc.addPageTemplates([PageTemplate("cover", frames=[Frame(0, 0, PW, PH)], onPage=cover),
                          PageTemplate("inner", frames=[frame], onPage=inner)])
    story = [NextPageTemplate("inner"), PageBreak()]

    # About + contents
    story += [Paragraph("ABOUT US", EYEBROW), Paragraph(esc(catalog.INTRO["title"]), H1), Spacer(1, 2 * mm)]
    story += [Paragraph(esc(p), BODY) for p in catalog.INTRO["paragraphs"]]
    story.append(Spacer(1, 4 * mm))
    cells = [[Paragraph(f"<b>{esc(t)}</b><br/>{esc(d)}", BODY) for _, t, d in catalog.STRENGTHS[i:i + 3]]
             for i in range(0, len(catalog.STRENGTHS), 3)]
    st = Table(cells, colWidths=[CW / 3] * 3)
    st.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                            ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("TOPPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
    story += [st, Spacer(1, 8 * mm), Paragraph("CONTENTS", EYEBROW), Spacer(1, 2 * mm)]
    toc = [[Paragraph(f"<font color='#D71920'><b>{i:02d}</b></font>", BODY), Paragraph(f"<b>{esc(f['title'])}</b>", BODY),
            Paragraph(esc(f["short"]), SMALL)] for i, f in enumerate(catalog.FAMILIES, 1)]
    toc.append([Paragraph(f"<font color='#D71920'><b>{len(catalog.FAMILIES) + 1:02d}</b></font>", BODY),
                Paragraph("<b>How to Repair</b>", BODY), Paragraph("Six-step repair method", SMALL)])
    tt = Table(toc, colWidths=[14 * mm, CW - 64 * mm, 50 * mm])
    tt.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [tt, Spacer(1, 6 * mm), img("neu-tech-full-range-precision-technology.jpg", CW, 70 * mm)]

    for n, fam in enumerate(catalog.FAMILIES, 1):
        story += [PageBreak()] + family_block(n, fam, catalog.SPECS.get(fam["slug"], []))

    # Versa Cure vs Chemical Cure
    story += [Spacer(1, 8 * mm), Paragraph("CHOOSE YOUR CURE", EYEBROW), Paragraph("Versa Cure &amp; Chemical Cure", H1)]
    cards = [[Paragraph(f"<b>{esc(t)}</b>  <font color='#5B6270'>({esc(c)})</font><br/>{esc(d)}", BODY)
              for t, c, d in catalog.CURE_TYPES]]
    ct = Table(cards, colWidths=[CW / 2] * 2)
    ct.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                            ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("TOPPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 8)]))
    story.append(KeepTogether([ct]))

    # Repair method + contact
    story += [PageBreak(), Paragraph(f"{len(catalog.FAMILIES) + 1:02d}  ·  REPAIR GUIDE", EYEBROW),
              Paragraph("How to repair with NEU-TECH patches", H1), Spacer(1, 4 * mm)]
    steps = [[Paragraph(f"<font color='#D71920' size='16'><b>{i}</b></font>", BODY),
              Paragraph(f"<b>{esc(t)}</b><br/>{esc(d)}", BODY)] for i, (t, d) in enumerate(catalog.REPAIR_STEPS, 1)]
    s = Table(steps, colWidths=[12 * mm, CW - 12 * mm])
    s.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [s, Spacer(1, 4 * mm), Paragraph(
        "<b>Important:</b> use radial patches only in radial tyres and bias patches only in bias tyres. "
        "Tyres with injuries beyond the patch range or bead damage should be checked by a tyre specialist.", SMALL)]
    co = catalog.COMPANY
    contact = Table([[img(catalog.LOGO, 26 * mm, 26 * mm),
                      Paragraph(f"<b>{esc(co['name'])}</b><br/>{esc(co['line'])}<br/>{'<br/>'.join(esc(a) for a in co['address_lines'])}"
                                f"<br/><br/><b>Phone / WhatsApp:</b> {esc(co['phone_display'])}<br/><b>E-mail:</b> {esc(co['email'])}"
                                f"<br/><b>GSTIN:</b> {esc(co['gstin'])}", BODY)]], colWidths=[34 * mm, CW - 34 * mm])
    contact.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), TINT), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                                 ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 10),
                                 ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("LEFTPADDING", (0, 0), (-1, -1), 10)]))
    story += [Spacer(1, 10 * mm), KeepTogether([Paragraph("CONTACT US", EYEBROW), Spacer(1, 2 * mm), contact])]

    doc.build(story)
    _CACHE.clear()
    _CACHE[key] = buf.getvalue()
    return _CACHE[key]
