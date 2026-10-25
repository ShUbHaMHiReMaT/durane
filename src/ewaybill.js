// e-Way Bill bulk-upload JSON for ewaybillgst.gov.in (e-Waybill -> Generate Bulk).
// The e-Way Bill itself (number, validity, barcode) can only be generated on the government portal.

function pincode(address) {
  const found = String(address || "").match(/(?<!\d)\d{3}\s?\d{3}(?!\d)/g);
  return found ? Number(found[found.length - 1].replace(/\s/g, "")) : 0;
}

/** Town/city: the last address line, without the PIN code. */
function place(address) {
  const lines = String(address || "").replace(/,/g, "\n").split("\n").map(l => l.trim().replace(/^[ ,]+|[ ,]+$/g, "")).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].replace(/[-\s]*\d{3}\s?\d{3}\s*$/, "").trim().replace(/^[ ,-]+|[ ,-]+$/g, "");
    if (text && !/^\d+$/.test(text) && !["karnataka", "india"].includes(text.toLowerCase())) return text.slice(0, 50);
  }
  return "";
}

function addrLines(address) {
  const flat = String(address || "").split("\n").map(l => l.trim().replace(/^[ ,]+|[ ,]+$/g, "")).filter(Boolean).join(", ");
  return [flat.slice(0, 120), flat.slice(120, 240)];
}

function stateCode(party) {
  const code = party.state_code || String(party.gstin || "").slice(0, 2) || "0";
  return /^\d+$/.test(code) ? Number(code) : 0;
}

/** Returns [bulk-upload object, list of problems to fix before uploading]. inv must be calculated. */
export function buildEwayJson(inv) {
  const s = inv.seller, b = inv.buyer, d = inv.details || {};
  const problems = [];
  const fromPin = pincode(s.address), toPin = pincode(b.address);
  if (!s.gstin) problems.push("Your company GSTIN is missing (Settings).");
  if (!fromPin) problems.push("Your company address has no 6-digit PIN code (Settings).");
  if (!toPin) problems.push("The client's address has no 6-digit PIN code. Edit the bill and add it.");
  if (!stateCode(b)) problems.push("The client's state is missing.");
  if (inv.invoice_no.length > 16) problems.push("Invoice numbers longer than 16 characters are not accepted by the portal.");
  if (!d.vehicle_no && !d.transporter_id) {
    problems.push("Add a vehicle number or a transporter ID, otherwise the e-Way Bill is not valid for movement.");
  }

  const [y, m, day] = inv.date.split("-");
  const [a1, a2] = addrLines(s.address), [t1, t2] = addrLines(b.address);
  const main = inv.tax_summary.length ? inv.tax_summary.reduce((x, r) => (r.taxable > x.taxable ? r : x)).hsn : "";
  let transDate = d.trans_doc_date || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(transDate)) transDate = transDate.split("-").reverse().join("/");
  const hsnNum = h => (/^\d+$/.test(String(h)) ? Number(h) : 0);

  const bill = {
    userGstin: s.gstin || "",
    supplyType: "O", subSupplyType: 1, subSupplyDesc: "",
    docType: "INV", docNo: inv.invoice_no, docDate: `${day}/${m}/${y}`,
    transType: 1,
    fromGstin: s.gstin || "", fromTrdName: s.name || "", fromAddr1: a1, fromAddr2: a2,
    fromPlace: place(s.address), fromPincode: fromPin, fromStateCode: stateCode(s), actualFromStateCode: stateCode(s),
    toGstin: b.gstin || "URP", toTrdName: b.name || "", toAddr1: t1, toAddr2: t2,
    toPlace: place(b.address), toPincode: toPin, toStateCode: stateCode(b), actualToStateCode: stateCode(b),
    totalValue: inv.subtotal, cgstValue: inv.cgst_amount, sgstValue: inv.sgst_amount, igstValue: inv.igst_amount,
    cessValue: 0, TotNonAdvolVal: 0, OthValue: inv.round_off, totInvValue: inv.grand_total,
    transMode: Number(d.trans_mode || 1), transDistance: String(d.trans_distance || "0"), // 0 = portal works it out from PIN codes
    transporterName: d.transporter_name || "", transporterId: String(d.transporter_id || "").toUpperCase(),
    transDocNo: d.lr_no || "", transDocDate: transDate,
    vehicleNo: String(d.vehicle_no || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase(), vehicleType: "R",
    mainHsnCode: hsnNum(main),
    itemList: inv.items.map((it, i) => ({
      itemNo: i + 1, productName: it.description.slice(0, 100), productDesc: it.description.slice(0, 100),
      hsnCode: hsnNum(it.hsn), quantity: it.qty, qtyUnit: "NOS", taxableAmount: it.amount,
      sgstRate: inv.tax_mode === "cgst_sgst" ? inv.sgst_rate : 0,
      cgstRate: inv.tax_mode === "cgst_sgst" ? inv.cgst_rate : 0,
      igstRate: inv.tax_mode === "igst" ? inv.igst_rate : 0,
      cessRate: 0, cessNonAdvol: 0,
    })),
  };
  return [{ version: "1.0.0621", billLists: [bill] }, problems];
}
