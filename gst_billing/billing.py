"""Invoice calculations and amount-in-words (Indian numbering)."""
from decimal import Decimal, ROUND_HALF_UP

BILL_TYPES = {
    "omkar": "Omkar Industries Bill",
    "ssi": "Shree Siddhivinayak Industries Bill",
    "pi_incl": "Proforma Invoice (Including GST)",
    "pi_excl": "Proforma Invoice (Excluding GST)",
    "other": "Other Bill",
}

# e-Way Bill (GST Rule 138) applies to tax invoices, not proforma invoices
EWAY_BILL_TYPES = ("omkar", "ssi", "other")


def eway_required(bill_type, grand_total, threshold):
    """Consignment value (taxable value + GST) above the threshold needs an e-Way Bill."""
    return bill_type in EWAY_BILL_TYPES and grand_total > threshold


PRICE_LISTS = {"internal": "Internal", "external": "External", "other": "Other"}

STATES = [
    ("01", "Jammu and Kashmir"), ("02", "Himachal Pradesh"), ("03", "Punjab"), ("04", "Chandigarh"),
    ("05", "Uttarakhand"), ("06", "Haryana"), ("07", "Delhi"), ("08", "Rajasthan"), ("09", "Uttar Pradesh"),
    ("10", "Bihar"), ("11", "Sikkim"), ("12", "Arunachal Pradesh"), ("13", "Nagaland"), ("14", "Manipur"),
    ("15", "Mizoram"), ("16", "Tripura"), ("17", "Meghalaya"), ("18", "Assam"), ("19", "West Bengal"),
    ("20", "Jharkhand"), ("21", "Odisha"), ("22", "Chhattisgarh"), ("23", "Madhya Pradesh"), ("24", "Gujarat"),
    ("26", "Dadra and Nagar Haveli and Daman and Diu"), ("27", "Maharashtra"), ("29", "Karnataka"),
    ("30", "Goa"), ("31", "Lakshadweep"), ("32", "Kerala"), ("33", "Tamil Nadu"), ("34", "Puducherry"),
    ("35", "Andaman and Nicobar Islands"), ("36", "Telangana"), ("37", "Andhra Pradesh"), ("38", "Ladakh"),
]


def r2(x):
    return float(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def r0(x):
    return float(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def num(x, default=0.0):
    try:
        return float(x) if x not in (None, "") else default
    except (TypeError, ValueError):
        return default


def financial_year(date_str):
    """'2026-10-21' -> '26-27' (Indian FY, April to March)."""
    y, m = int(date_str[:4]), int(date_str[5:7])
    start = y if m >= 4 else y - 1
    return f"{start % 100:02d}-{(start + 1) % 100:02d}"


def billed_qty(entered, pct):
    """Apply the '% for billing quantity' rule. 100% keeps the entered quantity unchanged."""
    entered = num(entered)
    if pct == 100:
        return entered
    return r0(entered * pct / 100)


def calculate(inv):
    """Fills computed fields on the invoice dict in place and returns it."""
    pct = num(inv.get("qty_pct"), 100) or 100
    inv["qty_pct"] = pct
    if inv["bill_type"] == "pi_excl":
        inv["tax_mode"] = "none"
    items, subtotal = [], 0.0
    for it in inv.get("items", []):
        if not str(it.get("description", "")).strip():
            continue
        qty = billed_qty(it.get("qty_entered"), pct)
        rate = num(it.get("rate"))
        disc = num(it.get("disc"))
        amount = r2(qty * rate * (1 - disc / 100))
        items.append(dict(description=str(it["description"]).strip(), hsn=str(it.get("hsn", "")).strip(),
                          qty_entered=num(it.get("qty_entered")), qty=qty, rate=rate,
                          unit=it.get("unit") or "unit", disc=disc, amount=amount))
        subtotal += amount
    inv["items"] = items
    subtotal = r2(subtotal)

    mode = inv.get("tax_mode", "none")
    rates = {"igst": num(inv.get("igst_rate")) if mode == "igst" else 0,
             "cgst": num(inv.get("cgst_rate")) if mode == "cgst_sgst" else 0,
             "sgst": num(inv.get("sgst_rate")) if mode == "cgst_sgst" else 0}

    # HSN-wise tax summary, as printed on the bill
    summary = {}
    for it in items:
        s = summary.setdefault(it["hsn"], {"hsn": it["hsn"], "taxable": 0.0})
        s["taxable"] = r2(s["taxable"] + it["amount"])
    for s in summary.values():
        for k, rate in rates.items():
            s[k] = r2(s["taxable"] * rate / 100)
        s["total_tax"] = r2(s["igst"] + s["cgst"] + s["sgst"])

    taxes = {k: r2(sum(s[k] for s in summary.values())) for k in rates}
    tax_total = r2(sum(taxes.values()))
    exact = r2(subtotal + tax_total)
    grand = r0(exact)

    inv.update(subtotal=subtotal, tax_total=tax_total, round_off=r2(grand - exact), grand_total=grand,
               igst_amount=taxes["igst"], cgst_amount=taxes["cgst"], sgst_amount=taxes["sgst"],
               tax_summary=list(summary.values()))
    return inv


ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
        "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n):
    return ONES[n] if n < 20 else (TENS[n // 10] + (" " + ONES[n % 10] if n % 10 else ""))


def _three(n):
    h, rest = divmod(n, 100)
    parts = []
    if h:
        parts.append(ONES[h] + " Hundred")
    if rest:
        parts.append(_two(rest))
    return " ".join(parts)


def int_words(n):
    if n == 0:
        return "Zero"
    parts = []
    crore, n = divmod(n, 10_000_000)
    lakh, n = divmod(n, 100_000)
    thousand, n = divmod(n, 1000)
    if crore:
        parts.append(int_words(crore) + " Crore")
    if lakh:
        parts.append(_two(lakh) + " Lakh")
    if thousand:
        parts.append(_two(thousand) + " Thousand")
    if n:
        parts.append(_three(n))
    return " ".join(parts)


def amount_words(x):
    x = r2(x)
    rupees = int(x)
    paise = int(round((x - rupees) * 100))
    s = "Rupees " + int_words(rupees)
    if paise:
        s += " and " + _two(paise) + " Paise"
    return s + " Only"
