"""e-Way Bill support.

The e-Way Bill itself (its number, validity and barcode) can only be generated on the government portal
(ewaybillgst.gov.in). This module prepares the portal's bulk-upload JSON for a saved invoice, so the bill
can be generated there without re-typing, and reads the number back from the portal's PDF.
"""
import os
import re

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "ewb")
TRANS_MODES = {"1": "Road", "2": "Rail", "3": "Air", "4": "Ship"}


def pdf_path(invoice_id):
    return os.path.join(UPLOAD_DIR, f"{int(invoice_id)}.pdf")


def _pincode(address):
    found = re.findall(r"(?<!\d)(\d{3}\s?\d{3})(?!\d)", address or "")
    return int(found[-1].replace(" ", "")) if found else 0


def _place(address):
    """Town/city: the last address line, without the PIN code."""
    lines = [l.strip(" ,") for l in (address or "").replace(",", "\n").split("\n") if l.strip(" ,")]
    for line in reversed(lines):
        text = re.sub(r"[-\s]*\d{3}\s?\d{3}\s*$", "", line).strip(" ,-")
        if text and not text.isdigit() and text.lower() not in ("karnataka", "india"):
            return text[:50]
    return ""


def _addr_lines(address):
    flat = ", ".join(l.strip(" ,") for l in (address or "").split("\n") if l.strip(" ,"))
    return flat[:120], flat[120:240]


def _state_code(party):
    code = (party.get("state_code") or (party.get("gstin") or "")[:2] or "0")
    return int(code) if str(code).isdigit() else 0


def build(inv):
    """Returns (bulk-upload dict, list of problems to fix before uploading)."""
    s, b, d = inv["seller"], inv["buyer"], inv.get("details", {})
    problems = []
    from_pin, to_pin = _pincode(s.get("address")), _pincode(b.get("address"))
    if not s.get("gstin"):
        problems.append("Your company GSTIN is missing (Settings).")
    if not from_pin:
        problems.append("Your company address has no 6-digit PIN code (Settings).")
    if not to_pin:
        problems.append("The client's address has no 6-digit PIN code. Edit the bill and add it.")
    if not _state_code(b):
        problems.append("The client's state is missing.")
    if len(inv["invoice_no"]) > 16:
        problems.append("Invoice numbers longer than 16 characters are not accepted by the portal.")
    if not d.get("vehicle_no") and not d.get("transporter_id"):
        problems.append("Add a vehicle number or a transporter ID, otherwise the e-Way Bill is not valid for movement.")

    y, m, day = inv["date"].split("-")
    a1, a2 = _addr_lines(s.get("address"))
    t1, t2 = _addr_lines(b.get("address"))
    hsn_main = max(inv["tax_summary"], key=lambda r: r["taxable"])["hsn"] if inv["tax_summary"] else ""
    distance = d.get("trans_distance") or "0"  # 0 lets the portal work out the distance from the PIN codes
    trans_date = d.get("trans_doc_date") or ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", trans_date):
        trans_date = "/".join(reversed(trans_date.split("-")))

    bill = {
        "userGstin": s.get("gstin", ""),
        "supplyType": "O", "subSupplyType": 1, "subSupplyDesc": "",
        "docType": "INV", "docNo": inv["invoice_no"], "docDate": f"{day}/{m}/{y}",
        "transType": 1,
        "fromGstin": s.get("gstin", ""), "fromTrdName": s.get("name", ""), "fromAddr1": a1, "fromAddr2": a2,
        "fromPlace": _place(s.get("address")), "fromPincode": from_pin,
        "fromStateCode": _state_code(s), "actualFromStateCode": _state_code(s),
        "toGstin": b.get("gstin") or "URP", "toTrdName": b.get("name", ""), "toAddr1": t1, "toAddr2": t2,
        "toPlace": _place(b.get("address")), "toPincode": to_pin,
        "toStateCode": _state_code(b), "actualToStateCode": _state_code(b),
        "totalValue": inv["subtotal"], "cgstValue": inv["cgst_amount"], "sgstValue": inv["sgst_amount"],
        "igstValue": inv["igst_amount"], "cessValue": 0, "TotNonAdvolVal": 0,
        "OthValue": inv["round_off"], "totInvValue": inv["grand_total"],
        "transMode": int(d.get("trans_mode") or 1), "transDistance": str(distance),
        "transporterName": d.get("transporter_name", ""), "transporterId": (d.get("transporter_id") or "").upper(),
        "transDocNo": d.get("lr_no", ""), "transDocDate": trans_date,
        "vehicleNo": re.sub(r"[^A-Za-z0-9]", "", d.get("vehicle_no") or "").upper(), "vehicleType": "R",
        "mainHsnCode": int(hsn_main) if str(hsn_main).isdigit() else 0,
        "itemList": [{
            "itemNo": i, "productName": it["description"][:100], "productDesc": it["description"][:100],
            "hsnCode": int(it["hsn"]) if str(it["hsn"]).isdigit() else 0,
            "quantity": it["qty"], "qtyUnit": "NOS", "taxableAmount": it["amount"],
            "sgstRate": inv["sgst_rate"] if inv["tax_mode"] == "cgst_sgst" else 0,
            "cgstRate": inv["cgst_rate"] if inv["tax_mode"] == "cgst_sgst" else 0,
            "igstRate": inv["igst_rate"] if inv["tax_mode"] == "igst" else 0,
            "cessRate": 0, "cessNonAdvol": 0,
        } for i, it in enumerate(inv["items"], 1)],
    }
    return {"version": "1.0.0621", "billLists": [bill]}, problems


def read_portal_pdf(path):
    """Pulls the e-Way Bill number and date out of the portal's PDF. Returns {} if it cannot be read."""
    try:
        import pymupdf
        text = "\n".join(page.get_text() for page in pymupdf.open(path))
    except Exception:
        return {}
    out = {}
    m = re.search(r"(?:Unique No\.?|E-?Way Bill No\.?)\s*:?\s*(\d{4}\s?\d{4}\s?\d{4})", text, re.I) or \
        re.search(r"(?<!\d)(\d{12})(?!\d)", text)
    if m:
        out["eway_bill_no"] = m.group(1).replace(" ", "")
    m = re.search(r"(?:Entered Date|Generated Date|Date)\s*:?\s*(\d{2})/(\d{2})/(\d{4})", text, re.I)
    if m:
        out["eway_bill_date"] = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return out
