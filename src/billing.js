// Invoice calculations and amount-in-words (Indian numbering).
// Same rules and rounding as the original Python version, so totals match old bills exactly.
import DATA from "./generated/data.json";

export const BILL_TYPES = DATA.bill_types;
export const PRICE_LISTS = DATA.price_lists;
export const STATES = DATA.states;
// e-Way Bill (GST Rule 138) applies to tax invoices, not proforma invoices
export const EWAY_BILL_TYPES = ["omkar", "ssi", "other"];

// Round half away from zero on the shortest decimal form of the number (like Python's Decimal(str(x)))
function roundTo(x, places) {
  const n = Number(x) || 0;
  const s = String(Math.abs(n));
  const scaled = s.includes("e") ? Math.abs(n) * 10 ** places : Number(`${s}e${places}`);
  const r = Math.round(scaled);
  const v = places ? Number(`${r}e-${places}`) : r;
  return n < 0 ? -v : v;
}
export const r2 = x => roundTo(x, 2);
export const r0 = x => roundTo(x, 0);

export function num(x, dflt = 0) {
  if (x === null || x === undefined || x === "") return dflt;
  const n = Number(x);
  return Number.isFinite(n) ? n : dflt;
}

/** '2026-10-21' -> '26-27' (Indian financial year, April to March) */
export function financialYear(dateStr) {
  const y = Number(dateStr.slice(0, 4)), m = Number(dateStr.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const two = v => String(v % 100).padStart(2, "0");
  return `${two(start)}-${two(start + 1)}`;
}

/** Apply the '% for billing quantity' rule. 100% keeps the entered quantity unchanged. */
export function billedQty(entered, pct) {
  const e = num(entered);
  return pct === 100 ? e : r0(e * pct / 100);
}

export function ewayRequired(billType, grandTotal, threshold) {
  return EWAY_BILL_TYPES.includes(billType) && grandTotal > threshold;
}

/** Fills computed fields on the invoice object in place and returns it. */
export function calculate(inv) {
  const pct = num(inv.qty_pct, 100) || 100;
  inv.qty_pct = pct;
  if (inv.bill_type === "pi_excl") inv.tax_mode = "none";
  const items = [];
  let subtotal = 0;
  for (const it of inv.items || []) {
    const description = String(it.description ?? "").trim();
    if (!description) continue;
    const qty = billedQty(it.qty_entered, pct);
    const rate = num(it.rate), disc = num(it.disc);
    const amount = r2(qty * rate * (1 - disc / 100));
    items.push({ description, hsn: String(it.hsn ?? "").trim(), qty_entered: num(it.qty_entered), qty, rate,
                 unit: it.unit || "unit", disc, amount });
    subtotal += amount;
  }
  inv.items = items;
  subtotal = r2(subtotal);

  const mode = inv.tax_mode || "none";
  const rates = {
    igst: mode === "igst" ? num(inv.igst_rate) : 0,
    cgst: mode === "cgst_sgst" ? num(inv.cgst_rate) : 0,
    sgst: mode === "cgst_sgst" ? num(inv.sgst_rate) : 0,
  };

  // HSN-wise tax summary, as printed on the bill
  const summary = new Map();
  for (const it of items) {
    const s = summary.get(it.hsn) || { hsn: it.hsn, taxable: 0 };
    s.taxable = r2(s.taxable + it.amount);
    summary.set(it.hsn, s);
  }
  const taxSummary = [...summary.values()];
  for (const s of taxSummary) {
    for (const k of Object.keys(rates)) s[k] = r2(s.taxable * rates[k] / 100);
    s.total_tax = r2(s.igst + s.cgst + s.sgst);
  }
  const taxes = {};
  for (const k of Object.keys(rates)) taxes[k] = r2(taxSummary.reduce((a, s) => a + s[k], 0));
  const taxTotal = r2(taxes.igst + taxes.cgst + taxes.sgst);
  const exact = r2(subtotal + taxTotal);
  const grand = r0(exact);

  Object.assign(inv, {
    subtotal, tax_total: taxTotal, round_off: r2(grand - exact), grand_total: grand,
    igst_amount: taxes.igst, cgst_amount: taxes.cgst, sgst_amount: taxes.sgst, tax_summary: taxSummary,
  });
  return inv;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const two = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""));
function three(n) {
  const h = Math.floor(n / 100), rest = n % 100, parts = [];
  if (h) parts.push(ONES[h] + " Hundred");
  if (rest) parts.push(two(rest));
  return parts.join(" ");
}

export function intWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(intWords(crore) + " Crore");
  if (lakh) parts.push(two(lakh) + " Lakh");
  if (thousand) parts.push(two(thousand) + " Thousand");
  if (n) parts.push(three(n));
  return parts.join(" ");
}

export function amountWords(x) {
  const v = r2(x);
  const rupees = Math.trunc(v);
  const paise = Math.round((v - rupees) * 100);
  let s = "Rupees " + intWords(rupees);
  if (paise) s += " and " + two(paise) + " Paise";
  return s + " Only";
}
