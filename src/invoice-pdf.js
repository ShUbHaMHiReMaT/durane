// A4 invoice PDF in the same layout as the existing Omkar / Siddhivinayak bills (pdf-lib, runs on Cloudflare).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import qrcode from "qrcode-generator";
import { amountWords, EWAY_BILL_TYPES } from "./billing.js";

const MM = 72 / 25.4;
const PW = 595.28, PH = 841.89;
const ML = 12 * MM, MT = 10 * MM, MB = 10 * MM;
const W = PW - 2 * ML;
const BLACK = rgb(0, 0, 0), GREY = rgb(0.93, 0.93, 0.93), LINE_W = 0.6;
const PAD_X = 3, PAD_Y = 2.5;
export const COPIES = ["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"];

// Standard PDF fonts only cover the Windows-1252 character set (no rupee sign).
const WIN_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
function safe(s) {
  return String(s ?? "").replace(/₹/g, "Rs.").replace(/\t/g, " ").split("").map(ch => {
    const c = ch.charCodeAt(0);
    if (ch === "\n" || (c >= 32 && c < 127) || (c >= 160 && c <= 255) || WIN_EXTRA.includes(ch)) return ch;
    return "?";
  }).join("");
}

const money = x => Number(x || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyStr = x => String(Number(x || 0));
const fmtDate = iso => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join("-") : iso || "");

/** Rich text: a paragraph is a list of runs [{t: text, b: bold}]; "\n" inside text starts a new line. */
class Writer {
  constructor(pdf, fonts) {
    this.pdf = pdf;
    this.f = fonts;
    this.page = null;
    this.y = 0;
  }

  newPage() {
    this.page = this.pdf.addPage([PW, PH]);
    this.y = MT;
  }

  room(h) {
    if (this.y + h > PH - MB) this.newPage();
  }

  font(bold) { return bold ? this.f.bold : this.f.reg; }

  /** Splits runs into lines that fit `width`. Returns [{tokens:[{t,b,w}], w}] */
  layout(runs, width, size) {
    const lines = [{ tokens: [], w: 0 }];
    const space = b => this.font(b).widthOfTextAtSize(" ", size);
    for (const run of runs) {
      const parts = safe(run.t).split("\n");
      parts.forEach((part, pi) => {
        if (pi > 0) lines.push({ tokens: [], w: 0 });
        for (const word of part.split(/ +/).filter(Boolean)) {
          const font = this.font(run.b);
          let piece = word;
          // break words that are wider than the whole line
          while (piece) {
            let cur = lines[lines.length - 1];
            const lead = cur.tokens.length ? space(run.b) : 0;
            let ww = font.widthOfTextAtSize(piece, size);
            if (cur.w + lead + ww <= width) {
              cur.tokens.push({ t: piece, b: run.b, w: ww, lead });
              cur.w += lead + ww;
              piece = "";
            } else if (cur.tokens.length) {
              lines.push({ tokens: [], w: 0 });
            } else {
              let n = piece.length;
              while (n > 1 && font.widthOfTextAtSize(piece.slice(0, n), size) > width) n--;
              ww = font.widthOfTextAtSize(piece.slice(0, n), size);
              cur.tokens.push({ t: piece.slice(0, n), b: run.b, w: ww, lead: 0 });
              cur.w += ww;
              lines.push({ tokens: [], w: 0 });
              piece = piece.slice(n);
            }
          }
        }
      });
    }
    while (lines.length > 1 && !lines[lines.length - 1].tokens.length) lines.pop();
    return lines;
  }

  /** Height of a paragraph in a box of inner width `width`. */
  measure(runs, width, size = 8, leading = size * 1.25) {
    return this.layout(runs, width, size).length * leading;
  }

  /** Draws a paragraph with its top at `top` (distance from the page top). Returns the height used. */
  para(runs, x, top, width, { size = 8, leading = size * 1.25, align = "left", color = BLACK } = {}) {
    const lines = this.layout(runs, width, size);
    lines.forEach((line, i) => {
      let cx = x + (align === "right" ? width - line.w : align === "center" ? (width - line.w) / 2 : 0);
      const baseline = PH - (top + i * leading + size * 0.95);
      for (const tok of line.tokens) {
        cx += tok.lead;
        this.page.drawText(tok.t, { x: cx, y: baseline, size, font: this.font(tok.b), color });
        cx += tok.w;
      }
    });
    return lines.length * leading;
  }

  rect(x, top, w, h, { fill = null, border = true } = {}) {
    this.page.drawRectangle({ x, y: PH - top - h, width: w, height: h, color: fill || undefined,
      borderColor: border ? BLACK : undefined, borderWidth: border ? LINE_W : 0 });
  }

  hline(x1, x2, top) {
    this.page.drawLine({ start: { x: x1, y: PH - top }, end: { x: x2, y: PH - top }, thickness: LINE_W, color: BLACK });
  }

  vline(x, top, bottom) {
    this.page.drawLine({ start: { x, y: PH - top }, end: { x, y: PH - bottom }, thickness: LINE_W, color: BLACK });
  }

  /** A row of bordered cells: cells = [{w, runs, align, size}] (w in points). Returns height. */
  cellRow(cells, { minH = 0, fill = null, draw = true } = {}) {
    let h = minH;
    for (const c of cells) h = Math.max(h, (c.runs ? this.measure(c.runs, c.w - 2 * PAD_X, c.size || 8) : 0) + 2 * PAD_Y);
    if (!draw) return h;
    let x = ML;
    for (const c of cells) {
      this.rect(x, this.y, c.w, h, { fill });
      if (c.runs) this.para(c.runs, x + PAD_X, this.y + PAD_Y, c.w - 2 * PAD_X, { align: c.align || "left", size: c.size || 8 });
      x += c.w;
    }
    this.y += h;
    return h;
  }
}

const B = t => ({ t: String(t ?? ""), b: true });
const N = t => ({ t: String(t ?? ""), b: false });

function partyRuns(label, p) {
  const runs = [];
  if (label) runs.push(B(label + "\n"));
  runs.push(B((p.name || "") + "\n"));
  if (p.address) runs.push(N(p.address + "\n"));
  if (p.gstin) runs.push(N("GSTIN/UIN: "), B(p.gstin + "\n"));
  if (p.state) runs.push(N(`State Name: ${p.state}${p.state_code ? `, Code: ${p.state_code}` : ""}\n`));
  if (p.email) runs.push(N(`E-mail: ${p.email}\n`));
  if (p.phone) runs.push(N(`Mob. No.: ${p.phone}`));
  return runs;
}

const titleFor = inv => (inv.bill_type.startsWith("pi_") ? "PROFORMA INVOICE" : "TAX INVOICE");

async function embedImage(pdf, bytes) {
  if (!bytes || bytes.length < 4) return null;
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
  } catch { /* unreadable image: print without logo */ }
  return null;
}

function drawCopy(w, inv, copyLabel, terms, logo) {
  const seller = inv.seller, buyer = inv.buyer, d = inv.details || {};
  w.newPage();

  // ---- header: logo, title, copy label
  let headH = 17 * MM;
  if (logo) {
    let lh = 20 * MM, lw = lh * logo.width / logo.height;
    if (lw > 60 * MM) { lw = 60 * MM; lh = lw * logo.height / logo.width; }
    w.page.drawImage(logo, { x: ML, y: PH - w.y - lh, width: lw, height: lh });
    headH = Math.max(headH, lh);
  }
  const mid = w.y + headH / 2;
  w.para([B(titleFor(inv))], ML + 62 * MM, mid - 8, W - 124 * MM, { size: 14, align: "center" });
  w.para([N(`(${copyLabel})`)], PW - ML - 62 * MM, mid - 4, 62 * MM, { align: "right" });
  w.y += headH + 2 * MM;

  // ---- seller / buyer (left) and reference grid (right)
  const half = W / 2, q = half / 2;
  const cell = (label, value) => [N(label + "\n"), B(value || "")];
  const meta = [
    [cell("Invoice No.", inv.invoice_no), cell("Dated", fmtDate(inv.date))],
    [cell("Delivery Note", d.delivery_note), cell("Mode/Terms of Payment", d.payment_terms)],
    [cell("Reference No. & Date", d.reference), cell("Other Reference", d.other_reference)],
    [cell("Buyer's Order No.", d.buyer_order_no), cell("Dated", d.buyer_order_date)],
    [cell("Dispatch Doc No.", d.dispatch_doc_no), cell("Delivery Note Dated", d.delivery_note_date)],
    [cell("Dispatched Through", d.dispatched_through), cell("Destination", d.destination)],
    [cell("Bill of Lading / LR-RR No.", d.lr_no), cell("Motor Vehicle No.", d.vehicle_no)],
  ];
  if (EWAY_BILL_TYPES.includes(inv.bill_type)) {
    meta.push([cell("e-Way Bill No.", d.eway_bill_no), cell("e-Way Bill Date", fmtDate(d.eway_bill_date))]);
  }
  const rowH = meta.map(r => Math.max(...r.map(c => w.measure(c, q - 2 * PAD_X))) + 2 * PAD_Y);
  const sellerRuns = partyRuns("", seller), buyerRuns = partyRuns("Bill To:", buyer);
  const hs = w.measure(sellerRuns, half - 2 * PAD_X) + 2 * PAD_Y;
  const hb = w.measure(buyerRuns, half - 2 * PAD_X) + 2 * PAD_Y;
  const H = Math.max(hs + hb, rowH.reduce((a, b) => a + b, 0));
  w.room(H);
  const top = w.y;
  w.rect(ML, top, W, H);
  w.vline(ML + half, top, top + H);
  w.para(sellerRuns, ML + PAD_X, top + PAD_Y, half - 2 * PAD_X);
  w.hline(ML, ML + half, top + hs);
  w.para(buyerRuns, ML + PAD_X, top + hs + PAD_Y, half - 2 * PAD_X);
  let ry = top;
  meta.forEach((r, i) => {
    w.para(r[0], ML + half + PAD_X, ry + PAD_Y, q - 2 * PAD_X);
    w.para(r[1], ML + half + q + PAD_X, ry + PAD_Y, q - 2 * PAD_X);
    w.vline(ML + half + q, ry, ry + rowH[i]);
    ry += rowH[i];
    w.hline(ML + half, ML + W, ry);
  });
  w.y = top + H;

  // ---- items
  const cw = [10, 62, 20, 18, 20, 12, 14].map(v => v * MM);
  cw.push(W - cw.reduce((a, b) => a + b, 0));
  const colX = cw.reduce((acc, v, i) => (acc.push(acc[i] + v), acc), [ML]);
  const header = ["Sr. No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "Per", "Disc %", "Amount"];
  const headerH = Math.max(...header.map((h, i) => w.measure([B(h)], cw[i] - 2 * PAD_X))) + 2 * PAD_Y;
  const drawHeader = () => {
    w.rect(ML, w.y, W, headerH, { fill: GREY });
    header.forEach((h, i) => {
      if (i) w.vline(colX[i], w.y, w.y + headerH);
      w.para([B(h)], colX[i] + PAD_X, w.y + PAD_Y, cw[i] - 2 * PAD_X, { align: "center" });
    });
    w.y += headerH;
  };
  const verticals = (t, h) => {
    for (let i = 0; i <= cw.length; i++) w.vline(colX[i], t, t + h);
  };
  w.room(headerH + 40);
  drawHeader();
  const body = (cells, { bold = false, minH = 0 } = {}) => {
    const aligns = ["center", "left", "center", "right", "right", "center", "right", "right"];
    const h = Math.max(minH, ...cells.map((c, i) => (c === "" ? 0 : w.measure([{ t: c, b: bold || i === 1 }], cw[i] - 2 * PAD_X))) ) + 2 * PAD_Y;
    if (w.y + h > PH - MB) {  // continue the table on a new page
      w.hline(ML, ML + W, w.y);
      w.newPage();
      drawHeader();
    }
    cells.forEach((c, i) => {
      if (c !== "") w.para([{ t: c, b: bold || i === 1 }], colX[i] + PAD_X, w.y + PAD_Y, cw[i] - 2 * PAD_X, { align: aligns[i] });
    });
    verticals(w.y, h);
    w.y += h;
  };
  let totalQty = 0;
  inv.items.forEach((it, i) => {
    totalQty += it.qty;
    body([String(i + 1), it.description, it.hsn, qtyStr(it.qty), money(it.rate), it.unit, it.disc ? qtyStr(it.disc) : "",
          money(it.amount)]);
  });
  for (let i = inv.items.length; i < 8; i++) body(["", "", "", "", "", "", "", ""], { minH: 12 - 2 * PAD_Y });
  w.hline(ML, ML + W, w.y);
  // labels in the description column are right-aligned like the original bill
  const sumRow = (label, value, bold = false) => {
    const h = w.measure([{ t: label, b: bold }], cw[1] - 2 * PAD_X) + 2 * PAD_Y;
    if (w.y + h > PH - MB) { w.hline(ML, ML + W, w.y); w.newPage(); drawHeader(); }
    w.para([{ t: label, b: bold }], colX[1] + PAD_X, w.y + PAD_Y, cw[1] - 2 * PAD_X, { align: "right" });
    w.para([{ t: value, b: bold }], colX[7] + PAD_X, w.y + PAD_Y, cw[7] - 2 * PAD_X, { align: "right" });
    verticals(w.y, h);
    w.y += h;
  };
  sumRow(inv.tax_mode !== "none" ? "Taxable Value" : "Sub Total", money(inv.subtotal));
  if (inv.tax_mode === "igst") sumRow(`IGST @ ${qtyStr(inv.igst_rate)}%`, money(inv.igst_amount));
  if (inv.tax_mode === "cgst_sgst") {
    sumRow(`CGST @ ${qtyStr(inv.cgst_rate)}%`, money(inv.cgst_amount));
    sumRow(`SGST @ ${qtyStr(inv.sgst_rate)}%`, money(inv.sgst_amount));
  }
  if (inv.round_off) sumRow("Round Off", (inv.round_off > 0 ? "+" : "") + inv.round_off.toFixed(2));
  w.hline(ML, ML + W, w.y);
  const totH = 12 + 2 * PAD_Y;
  w.room(totH);
  w.para([B("Total")], colX[1] + PAD_X, w.y + PAD_Y, cw[1] - 2 * PAD_X, { align: "right" });
  w.para([B(qtyStr(totalQty))], colX[3] + PAD_X, w.y + PAD_Y, cw[3] - 2 * PAD_X, { align: "right" });
  w.para([B("Rs. " + money(inv.grand_total))], colX[7] + PAD_X, w.y + PAD_Y, cw[7] - 2 * PAD_X, { align: "right" });
  verticals(w.y, totH);
  w.y += totH;
  w.hline(ML, ML + W, w.y);

  const full = runs => {
    w.room(w.cellRow([{ w: W, runs }], { draw: false }));
    w.cellRow([{ w: W, runs }]);
  };
  full([N("Amount Chargeable (in words): "), B(amountWords(inv.grand_total))]);
  if (inv.bill_type === "pi_excl") full([B("Note: "), N("Prices are exclusive of GST. GST will be charged extra as applicable.")]);

  // ---- HSN-wise tax summary
  if (inv.tax_mode !== "none") {
    const igst = inv.tax_mode === "igst";
    const widths = (igst ? [0.24, 0.22, 0.14, 0.18, 0.22] : [0.2, 0.18, 0.1, 0.14, 0.1, 0.14, 0.14]).map(f => f * W);
    const xs = widths.reduce((acc, v, i) => (acc.push(acc[i] + v), acc), [ML]);
    const h1 = 13, h2 = 13;
    w.room(h1 + h2 + 14 * (inv.tax_summary.length + 1));
    const t = w.y;
    w.rect(ML, t, W, h1 + h2, { fill: GREY });
    const spanCols = igst ? [[2, 3, "IGST"]] : [[2, 3, "CGST"], [4, 5, "SGST"]];
    const single = igst ? [[0, "HSN/SAC"], [1, "Taxable Value"], [4, "Total Tax Amount"]]
      : [[0, "HSN/SAC"], [1, "Taxable Value"], [6, "Total Tax Amount"]];
    for (const [i, label] of single) {
      w.vline(xs[i], t, t + h1 + h2);
      w.para([B(label)], xs[i] + PAD_X, t + (h1 + h2) / 2 - 5, widths[i] - 2 * PAD_X, { align: "center" });
    }
    for (const [a, bcol, label] of spanCols) {
      w.vline(xs[a], t, t + h1 + h2);
      w.para([B(label)], xs[a] + PAD_X, t + PAD_Y, widths[a] + widths[bcol] - 2 * PAD_X, { align: "center" });
      w.hline(xs[a], xs[bcol + 1], t + h1);
      w.vline(xs[bcol], t + h1, t + h1 + h2);
      w.para([B("Rate")], xs[a] + PAD_X, t + h1 + PAD_Y, widths[a] - 2 * PAD_X, { align: "center" });
      w.para([B("Amount")], xs[bcol] + PAD_X, t + h1 + PAD_Y, widths[bcol] - 2 * PAD_X, { align: "center" });
    }
    w.y = t + h1 + h2;
    const row = (cells, bold) => {
      w.cellRow(cells.map((c, i) => ({ w: widths[i], runs: [{ t: c, b: bold }], align: i === 0 ? (bold ? "right" : "center") : "right" })));
    };
    for (const s of inv.tax_summary) {
      row(igst ? [s.hsn, money(s.taxable), `${qtyStr(inv.igst_rate)}%`, money(s.igst), money(s.total_tax)]
               : [s.hsn, money(s.taxable), `${qtyStr(inv.cgst_rate)}%`, money(s.cgst), `${qtyStr(inv.sgst_rate)}%`,
                  money(s.sgst), money(s.total_tax)], false);
    }
    row(igst ? ["Total", money(inv.subtotal), "", money(inv.igst_amount), money(inv.tax_total)]
             : ["Total", money(inv.subtotal), "", money(inv.cgst_amount), "", money(inv.sgst_amount), money(inv.tax_total)], true);
    full([N("Tax Amount (in words): "), B(amountWords(inv.tax_total))]);
  }

  // ---- terms, bank details, UPI QR
  const bank = [B("Company's Bank Details\n")];
  for (const [label, key] of [["A/c Holder's Name", "bank_holder"], ["Bank Name", "bank_name"], ["A/c No.", "bank_account"],
    ["Branch", "bank_branch"], ["IFS Code", "bank_ifsc"], ["Company's PAN", "pan"]]) {
    if (seller[key]) bank.push(N(label + ": "), B(seller[key] + "\n"));
  }
  const termRuns = [B("Terms & Conditions\n"), N(terms || "")];
  const qrW = 36 * MM;
  const withQr = !!seller.upi_id && inv.grand_total > 0;
  const widths = withQr ? [W * 0.4, W * 0.6 - qrW, qrW] : [W / 2, W / 2];
  const hTerms = w.measure(termRuns, widths[0] - 2 * PAD_X, 7, 8.75) + 2 * PAD_Y;
  const hBank = w.measure(bank, widths[1] - 2 * PAD_X) + 2 * PAD_Y;
  const caption = withQr ? [N(`Scan to pay Rs. ${money(inv.grand_total)}\nUPI: ${seller.upi_id}`)] : null;
  const hQr = withQr ? 26 * MM + 4 + w.measure(caption, qrW - 2 * PAD_X, 7, 8.75) + 2 * PAD_Y : 0;
  const hRow = Math.max(hTerms, hBank, hQr);
  w.room(hRow);
  let x = ML;
  widths.forEach(wd => { w.rect(x, w.y, wd, hRow); x += wd; });
  w.para(termRuns, ML + PAD_X, w.y + PAD_Y, widths[0] - 2 * PAD_X, { size: 7, leading: 8.75 });
  w.para(bank, ML + widths[0] + PAD_X, w.y + PAD_Y, widths[1] - 2 * PAD_X);
  if (withQr) {
    const uri = `upi://pay?pa=${encodeURIComponent(seller.upi_id)}&pn=${encodeURIComponent(seller.name || "")}` +
      `&am=${inv.grand_total.toFixed(2)}&cu=INR&tn=${encodeURIComponent("Invoice " + inv.invoice_no)}`;
    const qr = qrcode(0, "M");
    qr.addData(uri);
    qr.make();
    const n = qr.getModuleCount(), size = 26 * MM, cellSize = size / n;
    const qx = ML + widths[0] + widths[1] + (qrW - size) / 2, qy = w.y + PAD_Y;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          w.page.drawRectangle({ x: qx + c * cellSize, y: PH - (qy + (r + 1) * cellSize), width: cellSize + 0.05,
            height: cellSize + 0.05, color: BLACK });
        }
      }
    }
    w.para(caption, ML + widths[0] + widths[1] + PAD_X, qy + size + 4, qrW - 2 * PAD_X, { size: 7, leading: 8.75, align: "center" });
  }
  w.y += hRow;

  // ---- declaration and signatory
  const decl = [B("Declaration: "), N("We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.")];
  const hDecl = Math.max(w.measure(decl, W / 2 - 2 * PAD_X) + 2 * PAD_Y, 10 * MM + 30);
  w.room(hDecl + 14);
  w.rect(ML, w.y, W / 2, hDecl);
  w.rect(ML + W / 2, w.y, W / 2, hDecl);
  w.para(decl, ML + PAD_X, w.y + PAD_Y, W / 2 - 2 * PAD_X);
  w.para([N("for "), B(seller.name || "")], ML + W / 2 + PAD_X, w.y + PAD_Y, W / 2 - 2 * PAD_X, { align: "right" });
  w.para([N("Authorised Signatory")], ML + W / 2 + PAD_X, w.y + hDecl - 12, W / 2 - 2 * PAD_X, { align: "right" });
  w.y += hDecl + 4;
  w.para([N("This is a computer generated invoice.")], ML, w.y, W, { size: 7, align: "center" });
}

/** Builds the invoice PDF. inv must already be calculated. logoBytes: PNG/JPG of the seller's logo (optional). */
export async function invoicePdf(inv, terms, { copies = "original", logoBytes = null } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${titleFor(inv) === "TAX INVOICE" ? "Tax Invoice" : "Proforma Invoice"} ${inv.invoice_no}`);
  pdf.setAuthor(inv.seller.name || "");
  const fonts = { reg: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const logo = await embedImage(pdf, logoBytes);
  const w = new Writer(pdf, fonts);
  for (const label of copies === "all" ? COPIES : [COPIES[0]]) drawCopy(w, inv, label, terms, logo);
  return pdf.save();
}
