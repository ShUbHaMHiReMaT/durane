"""A4 invoice PDF in the same layout as the existing Omkar / Siddhivinayak bills."""
import io
import os
from urllib.parse import quote

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from billing import EWAY_BILL_TYPES, amount_words

BASE = os.path.dirname(os.path.abspath(__file__))
LOGO_DIR = os.path.join(BASE, "static", "logos")

COPIES = ["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"]

try:
    pdfmetrics.registerFont(TTFont("Arial", r"C:\Windows\Fonts\arial.ttf"))
    pdfmetrics.registerFont(TTFont("Arial-Bold", r"C:\Windows\Fonts\arialbd.ttf"))
    pdfmetrics.registerFontFamily("Arial", normal="Arial", bold="Arial-Bold", italic="Arial", boldItalic="Arial-Bold")
    FONT, BOLD, RS = "Arial", "Arial-Bold", "\u20b9"
except Exception:
    FONT, BOLD, RS = "Helvetica", "Helvetica-Bold", "Rs."

S = ParagraphStyle("n", fontName=FONT, fontSize=8, leading=10)
SB = ParagraphStyle("b", parent=S, fontName=BOLD)
SR = ParagraphStyle("r", parent=S, alignment=TA_RIGHT)
SRB = ParagraphStyle("rb", parent=SB, alignment=TA_RIGHT)
SC = ParagraphStyle("c", parent=S, alignment=TA_CENTER)
SCB = ParagraphStyle("cb", parent=SB, alignment=TA_CENTER)
SMALL = ParagraphStyle("s", parent=S, fontSize=7, leading=8.5)
TITLE = ParagraphStyle("t", parent=SB, fontSize=14, leading=17, alignment=TA_CENTER)

W = A4[0] - 24 * mm
GRID = colors.black


def esc(s):
    return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")


def money(x):
    return f"{x:,.2f}"


def qty_str(x):
    return f"{x:g}"


def P(text, style=S):
    return Paragraph(text, style)


def box(data, widths, extra=None, grid=True):
    t = Table(data, colWidths=widths)
    st = [("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
          ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if grid:
        st.append(("GRID", (0, 0), (-1, -1), 0.6, GRID))
    t.setStyle(TableStyle(st + (extra or [])))
    return t


def party_block(label, p):
    lines = [f"<b>{label}</b>"] if label else []
    lines.append(f"<b>{esc(p.get('name'))}</b>")
    if p.get("address"):
        lines.append(esc(p["address"]))
    if p.get("gstin"):
        lines.append(f"GSTIN/UIN: <b>{esc(p['gstin'])}</b>")
    if p.get("state"):
        lines.append(f"State Name: {esc(p['state'])}" + (f", Code: {esc(p['state_code'])}" if p.get("state_code") else ""))
    if p.get("email"):
        lines.append(f"E-mail: {esc(p['email'])}")
    if p.get("phone"):
        lines.append(f"Mob. No.: {esc(p['phone'])}")
    return P("<br/>".join(lines))


def title_for(inv):
    return "PROFORMA INVOICE" if inv["bill_type"].startswith("pi_") else "TAX INVOICE"


def build_copy(inv, copy_label, terms):
    seller, buyer, d = inv["seller"], inv["buyer"], inv.get("details", {})
    story = []

    # Header: logo + title + copy label
    logo_cell = ""
    logo = seller.get("logo")
    if logo and os.path.exists(os.path.join(LOGO_DIR, logo)):
        img = Image(os.path.join(LOGO_DIR, logo))
        ratio = img.imageWidth / float(img.imageHeight)
        img.drawHeight = 20 * mm
        img.drawWidth = 20 * mm * ratio
        if img.drawWidth > 60 * mm:
            img.drawWidth, img.drawHeight = 60 * mm, 60 * mm / ratio
        img.hAlign = "LEFT"
        logo_cell = img
    head = [[logo_cell, P(title_for(inv), TITLE), P(f"({copy_label})", SR)]]
    story.append(box(head, [62 * mm, W - 124 * mm, 62 * mm], grid=False,
                     extra=[("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story.append(Spacer(1, 2 * mm))

    # Seller / buyer on the left, reference grid on the right
    def cell(label, value):
        return P(f"{label}<br/><b>{esc(value)}</b>")

    meta = [
        [cell("Invoice No.", inv["invoice_no"]), cell("Dated", inv["date_display"])],
        [cell("Delivery Note", d.get("delivery_note")), cell("Mode/Terms of Payment", d.get("payment_terms"))],
        [cell("Reference No. &amp; Date", d.get("reference")), cell("Other Reference", d.get("other_reference"))],
        [cell("Buyer's Order No.", d.get("buyer_order_no")), cell("Dated", d.get("buyer_order_date"))],
        [cell("Dispatch Doc No.", d.get("dispatch_doc_no")), cell("Delivery Note Dated", d.get("delivery_note_date"))],
        [cell("Dispatched Through", d.get("dispatched_through")), cell("Destination", d.get("destination"))],
        [cell("Bill of Lading / LR-RR No.", d.get("lr_no")), cell("Motor Vehicle No.", d.get("vehicle_no"))],
    ]
    if inv["bill_type"] in EWAY_BILL_TYPES:
        ewb_date = d.get("eway_bill_date") or ""
        if len(ewb_date) == 10 and ewb_date[4] == "-":
            ewb_date = "-".join(reversed(ewb_date.split("-")))
        meta.append([cell("e-Way Bill No.", d.get("eway_bill_no")), cell("e-Way Bill Date", ewb_date)])
    half = W / 2
    meta_t = box(meta, [half / 2, half / 2], extra=[("BOX", (0, 0), (-1, -1), 0, colors.white)])
    left = box([[party_block("", seller)], [party_block("Bill To:", buyer)]], [half],
               extra=[("BOX", (0, 0), (-1, -1), 0, colors.white)])
    story.append(box([[left, meta_t]], [half, half],
                     extra=[("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))

    # Items
    cw = [10 * mm, 62 * mm, 20 * mm, 18 * mm, 20 * mm, 12 * mm, 14 * mm]
    cw.append(W - sum(cw))
    rows = [[P(h, SCB) for h in ("Sr. No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "Per", "Disc %", "Amount")]]
    total_qty = 0
    for i, it in enumerate(inv["items"], 1):
        total_qty += it["qty"]
        rows.append([P(str(i), SC), P(esc(it["description"]), SB), P(esc(it["hsn"]), SC), P(qty_str(it["qty"]), SR),
                     P(money(it["rate"]), SR), P(esc(it["unit"]), SC), P(qty_str(it["disc"]) if it["disc"] else "", SR),
                     P(money(it["amount"]), SR)])
    for _ in range(max(0, 8 - len(inv["items"]))):
        rows.append([""] * 8)
    n_items_end = len(rows)

    def summary_row(label, value, bold=False):
        return ["", P(label, SRB if bold else SR), "", "", "", "", "", P(value, SRB if bold else SR)]

    rows.append(summary_row("Taxable Value" if inv["tax_mode"] != "none" else "Sub Total", money(inv["subtotal"])))
    if inv["tax_mode"] == "igst":
        rows.append(summary_row(f"IGST @ {qty_str(inv['igst_rate'])}%", money(inv["igst_amount"])))
    elif inv["tax_mode"] == "cgst_sgst":
        rows.append(summary_row(f"CGST @ {qty_str(inv['cgst_rate'])}%", money(inv["cgst_amount"])))
        rows.append(summary_row(f"SGST @ {qty_str(inv['sgst_rate'])}%", money(inv["sgst_amount"])))
    if inv["round_off"]:
        rows.append(summary_row("Round Off", f"{inv['round_off']:+.2f}"))
    total_row = len(rows)
    rows.append(["", P("Total", SRB), "", P(qty_str(total_qty), SRB), "", "", "", P(f"{RS} {money(inv['grand_total'])}", SRB)])

    it_style = [("GRID", (0, 0), (-1, 0), 0.6, GRID), ("BOX", (0, 0), (-1, -1), 0.6, GRID),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")),
                ("LINEABOVE", (0, n_items_end), (-1, n_items_end), 0.6, GRID),
                ("LINEABOVE", (0, total_row), (-1, total_row), 0.6, GRID),
                ("ROWBACKGROUNDS", (0, 1), (-1, n_items_end - 1), [colors.white])]
    for c in range(1, 8):
        it_style.append(("LINEBEFORE", (c, 0), (c, -1), 0.6, GRID))
    heights = [None] + [None] * len(inv["items"]) + [12] * (n_items_end - 1 - len(inv["items"])) \
        + [None] * (len(rows) - n_items_end)
    t = Table(rows, colWidths=cw, repeatRows=1, rowHeights=heights)
    t.setStyle(TableStyle(it_style + [("VALIGN", (0, 0), (-1, -1), "TOP"),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                                      ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
    story.append(t)

    story.append(box([[P(f"Amount Chargeable (in words): <b>{amount_words(inv['grand_total'])}</b>")]], [W]))
    if inv["tax_mode"] == "none" and inv["bill_type"] == "pi_excl":
        story.append(box([[P("<b>Note:</b> Prices are exclusive of GST. GST will be charged extra as applicable.")]], [W]))

    # HSN-wise tax summary
    if inv["tax_mode"] != "none":
        if inv["tax_mode"] == "igst":
            hdr = [[P("HSN/SAC", SCB), P("Taxable Value", SCB), P("IGST", SCB), "", P("Total Tax Amount", SCB)],
                   ["", "", P("Rate", SCB), P("Amount", SCB), ""]]
            body = [[P(esc(s["hsn"]), SC), P(money(s["taxable"]), SR), P(f"{qty_str(inv['igst_rate'])}%", SR),
                     P(money(s["igst"]), SR), P(money(s["total_tax"]), SR)] for s in inv["tax_summary"]]
            foot = [[P("Total", SRB), P(money(inv["subtotal"]), SRB), "", P(money(inv["igst_amount"]), SRB),
                     P(money(inv["tax_total"]), SRB)]]
            widths = [W * .24, W * .22, W * .14, W * .18, W * .22]
            spans = [("SPAN", (2, 0), (3, 0)), ("SPAN", (0, 0), (0, 1)), ("SPAN", (1, 0), (1, 1)), ("SPAN", (4, 0), (4, 1))]
        else:
            hdr = [[P("HSN/SAC", SCB), P("Taxable Value", SCB), P("CGST", SCB), "", P("SGST", SCB), "", P("Total Tax Amount", SCB)],
                   ["", "", P("Rate", SCB), P("Amount", SCB), P("Rate", SCB), P("Amount", SCB), ""]]
            body = [[P(esc(s["hsn"]), SC), P(money(s["taxable"]), SR), P(f"{qty_str(inv['cgst_rate'])}%", SR),
                     P(money(s["cgst"]), SR), P(f"{qty_str(inv['sgst_rate'])}%", SR), P(money(s["sgst"]), SR),
                     P(money(s["total_tax"]), SR)] for s in inv["tax_summary"]]
            foot = [[P("Total", SRB), P(money(inv["subtotal"]), SRB), "", P(money(inv["cgst_amount"]), SRB), "",
                     P(money(inv["sgst_amount"]), SRB), P(money(inv["tax_total"]), SRB)]]
            widths = [W * .2, W * .18, W * .1, W * .14, W * .1, W * .14, W * .14]
            spans = [("SPAN", (2, 0), (3, 0)), ("SPAN", (4, 0), (5, 0)), ("SPAN", (0, 0), (0, 1)),
                     ("SPAN", (1, 0), (1, 1)), ("SPAN", (6, 0), (6, 1))]
        story.append(box(hdr + body + foot, widths,
                         extra=spans + [("VALIGN", (0, 0), (-1, 1), "MIDDLE"),
                                        ("BACKGROUND", (0, 0), (-1, 1), colors.HexColor("#eeeeee"))]))
        story.append(box([[P(f"Tax Amount (in words): <b>{amount_words(inv['tax_total'])}</b>")]], [W]))

    # Bank details, UPI QR, terms
    bank_lines = [(label, seller.get(k)) for label, k in (("A/c Holder's Name", "bank_holder"), ("Bank Name", "bank_name"),
                                                         ("A/c No.", "bank_account"), ("Branch", "bank_branch"),
                                                         ("IFS Code", "bank_ifsc"), ("Company's PAN", "pan"))]
    bank = "<br/>".join(["<b>Company's Bank Details</b>"] +
                        [f"{label}: <b>{esc(v)}</b>" for label, v in bank_lines if v])
    terms_p = P("<b>Terms &amp; Conditions</b><br/>" + esc(terms), SMALL)
    qr_cell = ""
    if seller.get("upi_id") and inv["grand_total"] > 0:
        uri = (f"upi://pay?pa={quote(seller['upi_id'])}&pn={quote(seller.get('name', ''))}"
               f"&am={inv['grand_total']:.2f}&cu=INR&tn={quote('Invoice ' + inv['invoice_no'])}")
        qw = QrCodeWidget(uri)
        b = qw.getBounds()
        size = 26 * mm
        dr = Drawing(size, size, transform=[size / (b[2] - b[0]), 0, 0, size / (b[3] - b[1]), 0, 0])
        dr.add(qw)
        qr_cell = Table([[dr], [P(f"Scan to pay {RS} {money(inv['grand_total'])}<br/>UPI: {esc(seller['upi_id'])}", SMALL)]],
                        colWidths=[34 * mm], style=[("ALIGN", (0, 0), (-1, -1), "CENTER")])
    if qr_cell:
        story.append(box([[terms_p, P(bank), qr_cell]], [W * 0.4, W * 0.6 - 36 * mm, 36 * mm],
                         extra=[("LINEBEFORE", (2, 0), (2, 0), 0, colors.white)]))
    else:
        story.append(box([[terms_p, P(bank)]], [W / 2, W / 2]))

    # Declaration and signatory
    decl = P("<b>Declaration:</b> We declare that this invoice shows the actual price of the goods described "
             "and that all particulars are true and correct.")
    sign = Table([[P(f"for <b>{esc(seller.get('name'))}</b>", SR)], [Spacer(1, 10 * mm)], [P("Authorised Signatory", SR)]],
                 colWidths=[W / 2 - 6])
    story.append(box([[decl, sign]], [W / 2, W / 2]))
    story.append(Spacer(1, 2 * mm))
    story.append(P("This is a computer generated invoice.", ParagraphStyle("f", parent=SMALL, alignment=TA_CENTER)))
    return story


def render(inv, terms, copies="original"):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=12 * mm, rightMargin=12 * mm, topMargin=10 * mm,
                            bottomMargin=10 * mm, title=f"{title_for(inv).title()} {inv['invoice_no']}",
                            author=inv["seller"].get("name", ""))
    labels = COPIES if copies == "all" else [COPIES[0]]
    story = []
    for i, label in enumerate(labels):
        if i:
            story.append(PageBreak())
        story.extend(build_copy(inv, label, terms))
    doc.build(story)
    return buf.getvalue()
