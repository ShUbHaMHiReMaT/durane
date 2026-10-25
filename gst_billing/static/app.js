// GST Billing - front end (plain JS, no build step)
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const view = $("#view");
const BASE = document.body.dataset.base || ""; // secret billing address
let BOOT = null, PRODUCTS = [], CLIENTS = [];

const TAB_ORDER = ["omkar", "ssi", "pi_incl", "pi_excl", "other"];
const EWAY_TYPES = ["omkar", "ssi", "other"]; // tax invoices; proforma invoices do not need an e-Way Bill
const ewayLimit = () => num(BOOT.settings.eway_threshold) || 50000;
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const money = n => Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => (v === "" || v == null || isNaN(+v) ? 0 : +v);
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const fmtDate = iso => (iso ? iso.split("-").reverse().join("-") : "");

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = "toast"), isError ? 5000 : 2500);
}

async function api(url, opts = {}) {
  const o = { ...opts };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers = { "Content-Type": "application/json" };
    o.body = JSON.stringify(o.body);
  }
  const res = await fetch(url, o);
  if (res.status === 401) { location.href = BASE + "/login"; throw new Error("Please log in again"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function loadLists() {
  [PRODUCTS, CLIENTS] = await Promise.all([api(BASE + "/api/products"), api(BASE + "/api/clients")]);
  $("#product-list").innerHTML = PRODUCTS.map(p => `<option value="${esc(p.name)}">${esc(p.code)} · ${esc(p.category)}</option>`).join("");
  $("#client-list").innerHTML = CLIENTS.map(c => `<option value="${esc(c.name)}"></option>`).join("");
}

function stateOptions(selected) {
  return `<option value="">-- Select state --</option>` + BOOT.states.map(s =>
    `<option value="${s.code}" ${s.code === selected ? "selected" : ""}>${esc(s.name)} (${s.code})</option>`).join("");
}
const stateName = code => (BOOT.states.find(s => s.code === code) || {}).name || "";

// ------------------------------------------------------------------ router
async function route() {
  const [, page, id] = location.hash.replace(/^#/, "").split("/");
  $$(".top nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === (page || "dashboard")));
  try {
    if (!page) return renderDashboard();
    if (page === "new") return renderForm();
    if (page === "edit") return renderForm(+id);
    if (page === "view") return renderInvoice(+id);
    if (page === "products") return renderProducts();
    if (page === "enquiries") return renderEnquiries();
    if (page === "clients") return renderClients();
    if (page === "settings") return renderSettings();
    view.innerHTML = `<div class="empty">Page not found.</div>`;
  } catch (e) {
    view.innerHTML = `<div class="card">${esc(e.message)}</div>`;
  }
}

// ------------------------------------------------------------------ dashboard
let currentTab = sessionStorage.getItem("tab") || "omkar";

async function renderDashboard() {
  view.innerHTML = `
    <div class="bar"><h1>Bills</h1>
      <div class="actions"><input id="search" class="search" placeholder="Search invoice no. or client">
      <a class="btn primary" href="#/new">+ New Bill</a></div></div>
    <div class="tabs" id="tabs"></div>
    <div class="table-wrap" id="list"></div>`;
  $("#search").addEventListener("input", filterList);
  await loadTab(currentTab);
}

async function loadTab(type) {
  currentTab = type;
  sessionStorage.setItem("tab", type);
  const data = await api(`${BASE}/api/invoices?bill_type=${type}`);
  $("#tabs").innerHTML = TAB_ORDER.map(t => `<button data-t="${t}" class="${t === type ? "active" : ""}">
      ${esc(BOOT.bill_types[t])}<span class="count">${data.counts[t] || 0}</span></button>`).join("");
  $$("#tabs button").forEach(b => b.onclick = () => loadTab(b.dataset.t));
  const rows = data.invoices;
  $("#list").innerHTML = rows.length ? `<table class="stack">
      <thead><tr><th>Invoice No.</th><th>Date</th><th>Client</th><th>From</th>
      <th class="num">Taxable</th><th class="num">Tax</th><th class="num">Total (₹)</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr class="link" data-id="${r.id}" data-q="${esc((r.invoice_no + " " + r.client).toLowerCase())}">
        <td class="full" data-label="Invoice No."><b>${esc(r.invoice_no)}</b>
          ${r.eway_pending ? `<span class="badge-warn">e-Way Bill pending</span>` : ""}</td>
        <td data-label="Date">${fmtDate(r.date)}</td><td data-label="Client">${esc(r.client)}</td>
        <td data-label="From">${esc(r.from)}</td>
        <td data-label="Taxable" class="num">${money(r.subtotal)}</td><td data-label="Tax" class="num">${money(r.tax_total)}</td>
        <td data-label="Total (₹)" class="num"><b>${money(r.grand_total)}</b></td>
        <td class="num"><a class="btn small" href="${BASE}/api/invoices/${r.id}/pdf?download=1">PDF</a></td>
      </tr>`).join("")}</tbody></table>`
    : `<div class="empty">No bills yet in this list.</div>`;
  $$("#list tr.link").forEach(tr => tr.onclick = e => { if (!e.target.closest("a")) location.hash = `#/view/${tr.dataset.id}`; });
  filterList();
}

function filterList() {
  const q = ($("#search")?.value || "").trim().toLowerCase();
  $$("#list tr.link").forEach(tr => (tr.style.display = !q || tr.dataset.q.includes(q) ? "" : "none"));
}

// ------------------------------------------------------------------ bill form
let F = null; // form state

function blankForm() {
  const s = BOOT.settings;
  return {
    id: null, bill_type: "", price_list: "external", company_id: "", new_company: {},
    invoice_no: "", invoice_suffix: "", date: BOOT.today,
    buyer: { name: "", address: "", gstin: "", state: "", state_code: "", phone: "", email: "" },
    tax_mode: "cgst_sgst", igst_rate: s.default_igst, cgst_rate: s.default_cgst, sgst_rate: s.default_sgst,
    qty_pct: 100, items: [blankItem()], details: {},
  };
}
const blankItem = () => ({ description: "", hsn: "40169310", qty_entered: "", rate: "", unit: "unit", disc: "" });

async function renderForm(id) {
  await loadLists();
  F = blankForm();
  if (id) {
    const inv = await api(`${BASE}/api/invoices/${id}`);
    Object.assign(F, {
      id, bill_type: inv.bill_type, price_list: inv.price_list, company_id: inv.company_id, date: inv.date,
      buyer: { ...F.buyer, ...inv.buyer }, tax_mode: inv.tax_mode, igst_rate: inv.igst_rate || BOOT.settings.default_igst,
      cgst_rate: inv.cgst_rate || BOOT.settings.default_cgst, sgst_rate: inv.sgst_rate || BOOT.settings.default_sgst,
      qty_pct: inv.qty_pct, details: inv.details,
      items: inv.items.map(it => ({ description: it.description, hsn: it.hsn, qty_entered: it.qty_entered,
                                    rate: it.rate, unit: it.unit, disc: it.disc || "" })),
    });
    if (["omkar", "ssi"].includes(inv.bill_type)) F.invoice_suffix = inv.invoice_no.split("/").pop();
    else F.invoice_no = inv.invoice_no;
  }
  view.innerHTML = `
    <div class="bar"><h1>${id ? "Edit Bill" : "New Bill"}</h1></div>
    <div class="card"><div class="grid">
      <div><label>Price List</label><select id="price_list">${Object.entries(BOOT.price_lists).map(([k, v]) =>
        `<option value="${k}" ${k === F.price_list ? "selected" : ""}>${v}</option>`).join("")}</select>
        <div class="hint">Product rates are taken from this list.</div></div>
      <div><label>Bill Format</label><select id="bill_type" ${id ? "disabled" : ""}><option value="">-- Select bill format --</option>
        ${["pi_excl", "pi_incl", "omkar", "ssi", "other"].map(k =>
          `<option value="${k}" ${k === F.bill_type ? "selected" : ""}>${esc(BOOT.bill_types[k])}</option>`).join("")}</select></div>
    </div></div>
    <div id="form-body"></div>`;
  $("#price_list").onchange = e => { F.price_list = e.target.value; refreshRates(); };
  $("#bill_type").onchange = e => { F.bill_type = e.target.value; F.company_id = ""; F.invoice_no = ""; renderFormBody(); };
  if (F.bill_type) renderFormBody();
}

function renderFormBody() {
  const body = $("#form-body");
  if (!F.bill_type) { body.innerHTML = ""; return; }
  const t = F.bill_type, fixed = ["omkar", "ssi"].includes(t), hasTax = t !== "pi_excl";
  if (fixed) F.company_id = BOOT.companies.find(c => c.kind === t).id;
  const D = F.details;
  const det = (key, label, type = "text") =>
    `<div><label>${label}</label><input data-d="${key}" type="${type}" value="${esc(D[key])}"></div>`;

  body.innerHTML = `
    <div class="two">
      <div class="card"><h2>From</h2><div id="from-box"></div></div>
      <div class="card"><h2>Invoice</h2><div class="grid">
        <div class="wide">${fixed
          ? `<label>Invoice No.</label><div class="prefix-input"><span id="inv-prefix">…</span>
             <input id="invoice_suffix" placeholder="01" value="${esc(F.invoice_suffix)}"></div>
             <div class="hint" id="inv-last">Type the number yourself, it is not auto-increased.</div>`
          : `<label>Invoice No.</label><input id="invoice_no" value="${esc(F.invoice_no)}">
             <div class="hint">Auto-numbered. You can change it.</div>`}</div>
        <div><label>Date</label><input id="date" type="date" value="${F.date}"></div>
        <div><label>% for Billing Quantity</label><input id="qty_pct" type="number" min="1" max="100" step="any" value="${F.qty_pct}">
          <div class="pct-quick">${[100, 25, 10].map(p => `<button type="button" class="small" data-pct="${p}">${p}%</button>`).join("")}</div></div>
      </div></div>
    </div>

    <div class="card"><h2>Bill To (Client)</h2><div class="grid">
      <div><label>Client Name</label><input id="b-name" list="client-list" autocomplete="off" value="${esc(F.buyer.name)}">
        <div class="hint">Start typing to pick a saved client. New clients are saved automatically.</div></div>
      <div><label>GSTIN/UIN</label><input id="b-gstin" value="${esc(F.buyer.gstin)}" style="text-transform:uppercase"></div>
      <div><label>State</label><select id="b-state">${stateOptions(F.buyer.state_code)}</select></div>
      <div><label>Mobile No.</label><input id="b-phone" type="tel" value="${esc(F.buyer.phone)}"></div>
      <div><label>E-mail</label><input id="b-email" type="email" value="${esc(F.buyer.email)}"></div>
      <div class="wide"><label>Address</label><textarea id="b-address" rows="2">${esc(F.buyer.address)}</textarea></div>
    </div></div>

    ${hasTax ? `<div class="card"><h2>GST</h2><div class="grid">
      <div class="wide radios">
        <label><input type="radio" name="tax_mode" value="cgst_sgst" ${F.tax_mode === "cgst_sgst" ? "checked" : ""}> Inside state (CGST + SGST)</label>
        <label><input type="radio" name="tax_mode" value="igst" ${F.tax_mode === "igst" ? "checked" : ""}> Outside state (IGST)</label>
      </div>
      <div class="tax-igst"><label>IGST %</label><input id="igst_rate" type="number" step="any" value="${F.igst_rate}"></div>
      <div class="tax-cs"><label>CGST %</label><input id="cgst_rate" type="number" step="any" value="${F.cgst_rate}"></div>
      <div class="tax-cs"><label>SGST %</label><input id="sgst_rate" type="number" step="any" value="${F.sgst_rate}"></div>
      <div class="wide hint" id="tax-hint"></div>
    </div></div>` : ""}

    <div class="card"><h2>Products</h2>
      <div class="table-wrap"><table class="items stack">
        <thead><tr><th style="width:32px">#</th><th>Product</th><th style="width:100px">HSN/SAC</th>
          <th style="width:85px" class="num">Qty</th><th style="width:85px" class="num">Billed Qty</th>
          <th style="width:70px">Per</th><th style="width:95px" class="num">Rate</th><th style="width:70px" class="num">Disc %</th>
          <th style="width:110px" class="num">Amount</th><th style="width:36px"></th></tr></thead>
        <tbody id="items"></tbody></table></div>
      <div class="bar" style="margin:12px 0 0"><button type="button" id="add-item">+ Add product</button>
        <div class="totals" id="totals"></div></div>
    </div>

    ${EWAY_TYPES.includes(t) ? `<div class="card" id="eway-card"><h2>e-Way Bill</h2><div class="grid">
      <div><label>e-Way Bill No.</label><input data-d="eway_bill_no" inputmode="numeric" maxlength="14"
        placeholder="12-digit number" value="${esc(D.eway_bill_no)}"></div>
      <div><label>e-Way Bill Date</label><input data-d="eway_bill_date" type="date" value="${esc(D.eway_bill_date)}"></div>
      <div class="wide" id="eway-hint"></div>
      <div class="wide"><h2 style="margin:4px 0 0;font-size:14px">Transport details (used for the e-Way Bill upload file)</h2></div>
      <div><label>Transporter ID (GSTIN / TRANSIN)</label><input data-d="transporter_id" maxlength="15" style="text-transform:uppercase" value="${esc(D.transporter_id)}"></div>
      <div><label>Transporter Name</label><input data-d="transporter_name" value="${esc(D.transporter_name)}" placeholder="e.g. VRL Logistics"></div>
      <div><label>Mode</label><select data-d="trans_mode">${[["1", "Road"], ["2", "Rail"], ["3", "Air"], ["4", "Ship"]].map(([k, v]) =>
        `<option value="${k}" ${(D.trans_mode || "1") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div><label>Distance (km)</label><input data-d="trans_distance" type="number" inputmode="numeric" min="0" value="${esc(D.trans_distance)}"
        placeholder="Leave empty: portal calculates"></div>
      <div><label>Vehicle No.</label><input data-d="vehicle_no" style="text-transform:uppercase" placeholder="e.g. KA22AB1234" value="${esc(D.vehicle_no)}"></div>
      <div><label>LR / RR No.</label><input data-d="lr_no" value="${esc(D.lr_no)}"></div>
      <div><label>LR / RR Date</label><input data-d="trans_doc_date" type="date" value="${esc(D.trans_doc_date)}"></div>
    </div></div>` : ""}

    <div class="card"><details ${Object.values(D).some(Boolean) ? "open" : ""}><summary>Other details (optional)</summary><div class="grid">
      ${det("delivery_note", "Delivery Note")}${det("payment_terms", "Mode/Terms of Payment")}
      ${det("reference", "Reference No. & Date")}${det("other_reference", "Other Reference")}
      ${det("buyer_order_no", "Buyer's Order No.")}${det("buyer_order_date", "Buyer's Order Date")}
      ${det("dispatch_doc_no", "Dispatch Doc No.")}${det("delivery_note_date", "Delivery Note Date")}
      ${det("dispatched_through", "Dispatched Through")}${det("destination", "Destination")}
      ${EWAY_TYPES.includes(t) ? "" : det("lr_no", "Bill of Lading / LR-RR No.") + det("vehicle_no", "Motor Vehicle No.")}
    </div></details></div>

    <div class="actions" style="justify-content:flex-end">
      <a class="btn" href="#/">Cancel</a><button class="primary" id="save">Save Bill</button></div>`;

  renderFrom();
  renderItems();
  if (!fixed && !F.invoice_no) fetchNextNumber();
  if (fixed) fetchPrefix();

  // wiring
  const inv = $("#invoice_no"); if (inv) inv.oninput = e => (F.invoice_no = e.target.value);
  const suf = $("#invoice_suffix"); if (suf) suf.oninput = e => (F.invoice_suffix = e.target.value);
  $("#date").onchange = e => { F.date = e.target.value || BOOT.today; if (fixed) fetchPrefix(); };
  $("#qty_pct").oninput = e => { F.qty_pct = e.target.value; renderItems(false); };
  $$("[data-pct]").forEach(b => b.onclick = () => { F.qty_pct = +b.dataset.pct; $("#qty_pct").value = F.qty_pct; renderItems(false); });
  $$("[data-d]").forEach(i => i.oninput = () => { F.details[i.dataset.d] = i.value; if (i.dataset.d === "eway_bill_no") updateEwayHint(); });

  $("#b-name").addEventListener("input", e => {
    F.buyer.name = e.target.value;
    const c = CLIENTS.find(c => c.name.toLowerCase() === e.target.value.trim().toLowerCase());
    if (c) {
      Object.assign(F.buyer, c);
      $("#b-gstin").value = c.gstin; $("#b-state").innerHTML = stateOptions(c.state_code);
      $("#b-phone").value = c.phone; $("#b-email").value = c.email; $("#b-address").value = c.address;
      autoTaxMode();
    }
  });
  $("#b-gstin").oninput = e => {
    F.buyer.gstin = e.target.value.toUpperCase();
    const code = F.buyer.gstin.slice(0, 2);
    if (/^\d\d$/.test(code) && BOOT.states.some(s => s.code === code)) {
      $("#b-state").value = code; setBuyerState(code);
    }
  };
  $("#b-state").onchange = e => setBuyerState(e.target.value);
  $("#b-phone").oninput = e => (F.buyer.phone = e.target.value);
  $("#b-email").oninput = e => (F.buyer.email = e.target.value);
  $("#b-address").oninput = e => (F.buyer.address = e.target.value);

  if (hasTax) {
    $$("[name=tax_mode]").forEach(r => r.onchange = () => { F.tax_mode = r.value; showTaxFields(); renderTotals(); });
    ["igst_rate", "cgst_rate", "sgst_rate"].forEach(k => $("#" + k).oninput = e => { F[k] = e.target.value; renderTotals(); });
    showTaxFields();
    if (!F.id) autoTaxMode();
  }
  $("#add-item").onclick = () => { F.items.push(blankItem()); renderItems(); $$("#items .p-name").pop().focus(); };
  $("#save").onclick = saveBill;
}

function setBuyerState(code) {
  F.buyer.state_code = code;
  F.buyer.state = stateName(code);
  autoTaxMode();
}

function sellerStateCode() {
  if (F.company_id === "new") return F.new_company.state_code || "";
  return (BOOT.companies.find(c => c.id == F.company_id) || {}).state_code || "";
}

// Same state -> CGST + SGST, different state -> IGST
function autoTaxMode() {
  if (F.bill_type === "pi_excl" || !$("[name=tax_mode]")) return;
  const s = sellerStateCode(), b = F.buyer.state_code;
  if (s && b) {
    F.tax_mode = s === b ? "cgst_sgst" : "igst";
    $(`[name=tax_mode][value=${F.tax_mode}]`).checked = true;
    showTaxFields();
    renderTotals();
  }
}

function showTaxFields() {
  $$(".tax-igst").forEach(el => (el.style.display = F.tax_mode === "igst" ? "" : "none"));
  $$(".tax-cs").forEach(el => (el.style.display = F.tax_mode === "cgst_sgst" ? "" : "none"));
  const s = sellerStateCode(), b = F.buyer.state_code;
  $("#tax-hint").textContent = s && b ? (s === b ? "Seller and client are in the same state." : "Seller and client are in different states.")
    : "Select the client's state to choose the GST type automatically.";
}

function renderFrom() {
  const box = $("#from-box"), t = F.bill_type;
  if (["omkar", "ssi"].includes(t)) {
    const c = BOOT.companies.find(c => c.kind === t);
    box.innerHTML = `<b>${esc(c.name)}</b><div style="white-space:pre-line">${esc(c.address)}</div>
      <div>GSTIN: ${esc(c.gstin)}</div>`;
    return;
  }
  const choices = BOOT.companies.filter(c => t === "other" ? c.kind === "other" : true);
  if (!F.company_id) F.company_id = choices.length ? choices[0].id : "new";
  box.innerHTML = `<label>Company</label><select id="company_id">
      ${choices.map(c => `<option value="${c.id}" ${c.id == F.company_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      <option value="new" ${F.company_id === "new" ? "selected" : ""}>Other (enter a new address)</option></select>
    <div id="from-detail" style="margin-top:10px"></div>`;
  $("#company_id").onchange = e => { F.company_id = e.target.value === "new" ? "new" : +e.target.value; renderFromDetail(); autoTaxMode(); };
  renderFromDetail();
}

function renderFromDetail() {
  const el = $("#from-detail");
  if (F.company_id !== "new") {
    const c = BOOT.companies.find(c => c.id == F.company_id);
    el.innerHTML = `<div style="white-space:pre-line">${esc(c.address)}</div><div>GSTIN: ${esc(c.gstin)}</div>`;
    return;
  }
  const n = F.new_company;
  const fld = (k, label) => `<div><label>${label}</label><input data-nc="${k}" value="${esc(n[k])}"></div>`;
  el.innerHTML = `<div class="grid">${fld("name", "Company Name")}${fld("gstin", "GSTIN")}
      <div><label>State</label><select data-nc="state_code">${stateOptions(n.state_code)}</select></div>
      ${fld("phone", "Mobile No.")}${fld("email", "E-mail")}
      <div class="wide"><label>Address</label><textarea data-nc="address" rows="2">${esc(n.address)}</textarea></div></div>
    <div class="hint">This address is saved for future bills. Bank details can be added in Settings.</div>`;
  $$("[data-nc]", el).forEach(i => i.oninput = i.onchange = () => {
    n[i.dataset.nc] = i.value;
    if (i.dataset.nc === "state_code") { n.state = stateName(i.value); autoTaxMode(); }
  });
}

async function fetchNextNumber() {
  const r = await api(`${BASE}/api/next-number?bill_type=${F.bill_type}`);
  F.invoice_no = r.number;
  if ($("#invoice_no")) $("#invoice_no").value = r.number;
}

async function fetchPrefix() {
  const r = await api(`${BASE}/api/next-number?bill_type=${F.bill_type}&date=${F.date}`);
  $("#inv-prefix").textContent = r.prefix;
  $("#inv-last").textContent = (r.last ? `Last used: ${r.last}. ` : "") + "Type the number yourself, it is not auto-increased.";
}

const findProduct = name => {
  const q = String(name || "").trim().toLowerCase();
  return PRODUCTS.find(p => p.name.toLowerCase() === q || (p.code || "").toLowerCase() === q);
};
const listRate = p => p["price_" + F.price_list];

function refreshRates() {
  if (!F.items) return;
  F.items.forEach(it => { const p = findProduct(it.description); if (p) it.rate = listRate(p) ?? ""; });
  if ($("#items")) renderItems(false);
}

function billedQty(entered) {
  const pct = num(F.qty_pct) || 100;
  return pct === 100 ? num(entered) : Math.round(num(entered) * pct / 100);
}

function renderItems(rebuild = true) {
  const tb = $("#items");
  if (rebuild) {
    tb.innerHTML = F.items.map((it, i) => `<tr data-i="${i}">
      <td class="row-no">${i + 1}</td>
      <td class="full" data-label="Product"><input class="p-name" list="product-list" autocomplete="off" value="${esc(it.description)}" placeholder="Type product name or code"></td>
      <td data-label="HSN/SAC"><input data-k="hsn" value="${esc(it.hsn)}"></td>
      <td data-label="Qty"><input data-k="qty_entered" type="number" inputmode="decimal" min="0" step="any" class="num" value="${esc(it.qty_entered)}"></td>
      <td data-label="Billed Qty" class="num b-qty"></td>
      <td data-label="Per"><input data-k="unit" value="${esc(it.unit)}"></td>
      <td data-label="Rate"><input data-k="rate" type="number" inputmode="decimal" min="0" step="any" value="${esc(it.rate)}"></td>
      <td data-label="Disc %"><input data-k="disc" type="number" inputmode="decimal" min="0" max="100" step="any" value="${esc(it.disc)}"></td>
      <td data-label="Amount" class="num amt"></td>
      <td class="row-del"><button type="button" class="small danger" title="Remove">✕</button></td></tr>`).join("");
    $$("#items tr").forEach(tr => {
      const it = F.items[+tr.dataset.i];
      $(".p-name", tr).oninput = e => {
        it.description = e.target.value;
        const p = findProduct(it.description);
        if (p) {
          it.description = p.name; it.hsn = p.hsn || "40169310"; it.unit = p.unit || "unit"; it.rate = listRate(p) ?? "";
          e.target.value = p.name;
          $("[data-k=hsn]", tr).value = it.hsn; $("[data-k=unit]", tr).value = it.unit; $("[data-k=rate]", tr).value = it.rate;
          if (it.rate === "") toast(`No ${BOOT.price_lists[F.price_list]} rate saved for ${p.name}. Enter the rate.`);
          updateRow(tr, it);
        }
      };
      $$("[data-k]", tr).forEach(inp => inp.oninput = () => { it[inp.dataset.k] = inp.value; updateRow(tr, it); });
      $("button", tr).onclick = () => { F.items.splice(+tr.dataset.i, 1); if (!F.items.length) F.items.push(blankItem()); renderItems(); };
    });
  } else {
    $$("#items tr").forEach(tr => {
      const it = F.items[+tr.dataset.i];
      $("[data-k=rate]", tr).value = it.rate;
    });
  }
  $$("#items tr").forEach(tr => updateRow(tr, F.items[+tr.dataset.i], false));
  renderTotals();
}

function itemAmount(it) {
  return r2(billedQty(it.qty_entered) * num(it.rate) * (1 - num(it.disc) / 100));
}

function updateRow(tr, it, totals = true) {
  const pct = num(F.qty_pct) || 100;
  $(".b-qty", tr).textContent = it.qty_entered === "" ? "" : billedQty(it.qty_entered) + (pct !== 100 ? ` (${pct}%)` : "");
  $(".amt", tr).textContent = it.description ? money(itemAmount(it)) : "";
  if (totals) renderTotals();
}

function renderTotals() {
  const el = $("#totals");
  if (!el) return;
  const items = F.items.filter(it => it.description.trim());
  // tax is worked out per HSN code, same as the printed bill
  const byHsn = {};
  items.forEach(it => (byHsn[it.hsn] = r2((byHsn[it.hsn] || 0) + itemAmount(it))));
  const sub = r2(Object.values(byHsn).reduce((a, b) => a + b, 0));
  const lines = [[F.bill_type === "pi_excl" ? "Sub Total" : "Taxable Value", sub]];
  let tax = 0;
  const addTax = (label, rate) => {
    const amt = r2(Object.values(byHsn).reduce((a, v) => a + r2(v * num(rate) / 100), 0));
    tax += amt;
    lines.push([`${label} @ ${num(rate)}%`, amt]);
  };
  if (F.bill_type !== "pi_excl") {
    if (F.tax_mode === "igst") addTax("IGST", F.igst_rate);
    else { addTax("CGST", F.cgst_rate); addTax("SGST", F.sgst_rate); }
  }
  const exact = r2(sub + tax), grand = Math.round(exact);
  if (r2(grand - exact)) lines.push(["Round Off", r2(grand - exact)]);
  el.innerHTML = lines.map(([k, v]) => `<div><span>${k}</span><span>${money(v)}</span></div>`).join("")
    + `<div class="grand"><span>Total</span><span>₹ ${money(grand)}</span></div>`;
  F.grand = grand;
  updateEwayHint();
}

function updateEwayHint() {
  const el = $("#eway-hint");
  if (!el) return;
  const limit = ewayLimit(), needed = F.grand > limit;
  $("#eway-card").classList.toggle("alert", needed && !F.details.eway_bill_no);
  el.innerHTML = needed
    ? `<div class="warn">e-Way Bill is mandatory: bill value ₹ ${money(F.grand)} is above ₹ ${money(limit)}.
       Generate it on the e-Way Bill portal (ewaybillgst.gov.in) and enter the number here before the goods are dispatched.</div>`
    : `<div class="hint">Not required for this bill. An e-Way Bill is needed only when the bill value is above ₹ ${money(limit)}.</div>`;
}

async function saveBill() {
  const btn = $("#save");
  const payload = { ...F, items: F.items.filter(it => it.description.trim()) };
  if (!payload.items.length) return toast("Add at least one product", true);
  const missing = payload.items.find(it => num(it.qty_entered) <= 0);
  if (missing) return toast(`Enter the quantity for ${missing.description}`, true);
  const ewb = (F.details.eway_bill_no || "").replace(/\s+/g, "");
  if (ewb && !/^\d{12}$/.test(ewb)) return toast("e-Way Bill number must be 12 digits", true);
  if (EWAY_TYPES.includes(F.bill_type) && F.grand > ewayLimit() && !ewb &&
      !confirm(`This bill is above ₹ ${money(ewayLimit())}, so an e-Way Bill is mandatory.\n\n`
               + `Save now and add the e-Way Bill number before dispatch?`)) {
    $("[data-d=eway_bill_no]").focus();
    return;
  }
  btn.disabled = true;
  try {
    const r = F.id ? await api(`${BASE}/api/invoices/${F.id}`, { method: "PUT", body: payload })
                   : await api(BASE + "/api/invoices", { method: "POST", body: payload });
    if (F.company_id === "new") BOOT = await api(BASE + "/api/bootstrap");
    toast(`Bill ${r.invoice_no} saved`);
    location.hash = `#/view/${r.id}`;
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ------------------------------------------------------------------ invoice view
async function renderInvoice(id) {
  const inv = await api(`${BASE}/api/invoices/${id}`);
  const pdf = `${BASE}/api/invoices/${id}/pdf`;
  const D = inv.details;
  const ewb = `${BASE}/api/invoices/${id}/ewb-pdf`;
  const ewayBox = EWAY_TYPES.includes(inv.bill_type) ? `<div class="card ${inv.eway_pending ? "alert" : ""}">
      <h2>e-Way Bill</h2>
      ${inv.eway_pending ? `<p class="warn">This bill's value (₹ ${money(inv.grand_total)}) is above ₹ ${money(inv.eway_threshold)},
          so an e-Way Bill is mandatory before the goods are dispatched.</p>`
        : !inv.eway_required ? `<p class="hint">Not required for this bill (value up to ₹ ${money(inv.eway_threshold)}). You can still make one if needed.</p>` : ""}
      ${D.eway_bill_no ? `<p>e-Way Bill No. <b>${esc(D.eway_bill_no)}</b>${D.eway_bill_date ? ` dated ${fmtDate(D.eway_bill_date)}` : ""}</p>` : ""}
      <ol class="ewb-steps">
        <li><b>Download the upload file</b> for this bill.
          <div class="actions"><button class="small" id="ewb-json">Download e-Way Bill JSON</button></div>
          <div id="ewb-problems"></div></li>
        <li><b>Generate it on the portal:</b> log in to ewaybillgst.gov.in, open <i>e-Waybill &rarr; Generate Bulk</i> and upload the file.
          <div class="actions"><a class="btn small" href="https://ewaybillgst.gov.in" target="_blank" rel="noopener">Open e-Way Bill portal</a></div></li>
        <li><b>Attach the e-Way Bill PDF</b> from the portal. Its number and date are filled in automatically.
          <div class="actions">${inv.has_ewb_pdf
            ? `<a class="btn small" href="${ewb}" target="_blank">View e-Way Bill PDF</a><button class="small danger" id="ewb-remove">Remove</button>` : ""}
            <label class="btn small file-btn">${inv.has_ewb_pdf ? "Replace PDF" : "Attach PDF"}<input type="file" id="ewb-file" accept="application/pdf" hidden></label></div></li>
      </ol>
      ${D.eway_bill_no ? "" : `<div class="grid" style="margin-top:8px">
        <div><label>Or type the e-Way Bill No.</label><input id="ewb-no" inputmode="numeric" maxlength="14" placeholder="12-digit number"></div>
        <div><label>e-Way Bill Date</label><input id="ewb-date" type="date" value="${BOOT.today}"></div>
        <div style="align-self:end"><button class="primary" id="ewb-save">Save e-Way Bill No.</button></div>
      </div>`}</div>` : "";
  // phone browsers cannot show a PDF inside the page, so offer a button there instead
  const preview = IS_MOBILE
    ? `<div class="card empty"><p>Tap below to open the bill.</p><a class="btn primary" href="${pdf}" target="_blank">Open PDF</a></div>`
    : `<iframe class="pdf" id="pdf-frame" src="${pdf}"></iframe>`;
  view.innerHTML = `
    <div class="bar"><div><h1>${esc(inv.invoice_no)} · ${esc(inv.buyer.name)}</h1>
      <div class="hint">${esc(BOOT.bill_types[inv.bill_type])} · ${fmtDate(inv.date)} · Total ₹ ${money(inv.grand_total)}
        ${D.eway_bill_no ? ` · e-Way Bill ${esc(D.eway_bill_no)}` : ""}</div></div>
      <div class="actions">
        <a class="btn primary" href="${pdf}?download=1">Download PDF</a>
        <a class="btn" href="${pdf}?copies=all&download=1" title="Original, Duplicate and Triplicate">Download 3 Copies</a>
        <button id="print">Print</button>
        <button id="wa">WhatsApp</button>
        <button id="mail">Email</button>
        <a class="btn" href="#/edit/${id}">Edit</a>
        <button id="del" class="danger">Delete</button>
      </div></div>
    ${ewayBox}${preview}`;

  if ($("#ewb-save")) $("#ewb-save").onclick = async () => {
    try {
      await api(`${BASE}/api/invoices/${id}/eway`, { method: "PUT", body: { eway_bill_no: $("#ewb-no").value, eway_bill_date: $("#ewb-date").value } });
      toast("e-Way Bill saved");
      renderInvoice(id);
    } catch (e) { toast(e.message, true); }
  };
  if ($("#ewb-json")) $("#ewb-json").onclick = async () => {
    const r = await api(`${BASE}/api/invoices/${id}/ewb-json`);
    $("#ewb-problems").innerHTML = r.problems.length
      ? `<div class="warn" style="margin-top:8px">Fix these first, or the portal may reject the file:<ul>${r.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
    a.download = r.filename;
    a.click();
    toast(r.problems.length ? "File downloaded, but please check the notes" : "e-Way Bill file downloaded");
  };
  if ($("#ewb-file")) $("#ewb-file").onchange = async e => {
    const fd = new FormData();
    fd.append("file", e.target.files[0]);
    try {
      const r = await api(ewb, { method: "POST", body: fd });
      toast(r.found.eway_bill_no ? `e-Way Bill ${r.found.eway_bill_no} attached` : "PDF attached. Enter the e-Way Bill number.");
      renderInvoice(id);
    } catch (err) { toast(err.message, true); }
  };
  if ($("#ewb-remove")) $("#ewb-remove").onclick = async () => {
    if (!confirm("Remove the attached e-Way Bill PDF?")) return;
    await api(ewb, { method: "DELETE" });
    renderInvoice(id);
  };

  $("#print").onclick = () => window.open(`${pdf}?copies=all`, "_blank");
  $("#wa").onclick = () => shareBill(inv, "whatsapp");
  $("#mail").onclick = () => shareBill(inv, "email");
  $("#del").onclick = async () => {
    if (!confirm(`Delete bill ${inv.invoice_no}? This cannot be undone.`)) return;
    await api(`${BASE}/api/invoices/${id}`, { method: "DELETE" });
    toast("Bill deleted");
    location.hash = "#/";
  };
}

async function shareBill(inv, via) {
  const url = `${BASE}/api/invoices/${inv.id}/pdf`;
  const blob = await (await fetch(url)).blob();
  const fname = `${inv.invoice_no.replace(/[^\w-]+/g, "_")}.pdf`;
  const files = [new File([blob], fname, { type: "application/pdf" })];
  if (inv.has_ewb_pdf) {  // send the e-Way Bill along with the invoice
    const ewbBlob = await (await fetch(`${BASE}/api/invoices/${inv.id}/ewb-pdf`)).blob();
    files.push(new File([ewbBlob], `e-Way-Bill_${fname}`, { type: "application/pdf" }));
  }
  const from = inv.seller.name;
  const ewbLine = inv.details.eway_bill_no ? `\ne-Way Bill No.: ${inv.details.eway_bill_no}` : "";
  const text = `Dear ${inv.buyer.name},\nPlease find attached invoice ${inv.invoice_no} dated ${fmtDate(inv.date)} `
    + `for ₹ ${money(inv.grand_total)}.${ewbLine}\n\nRegards,\n${from}`;

  // Phones can share the PDF files straight into WhatsApp or Mail
  if (navigator.canShare && navigator.canShare({ files }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files, title: fname, text }); } catch (e) { /* user cancelled */ }
    return;
  }
  // Desktop: download the PDFs, then open WhatsApp / mail with the message ready
  files.forEach(f => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
  });
  if (via === "whatsapp") {
    window.open(`https://wa.me/${waNumber(inv.buyer.phone)}?text=${encodeURIComponent(text)}`, "_blank");
  } else {
    location.href = `mailto:${encodeURIComponent(inv.buyer.email || "")}?subject=${encodeURIComponent(`Invoice ${inv.invoice_no} - ${from}`)}&body=${encodeURIComponent(text)}`;
  }
  toast("PDF downloaded. Attach it to the message.");
}

// ------------------------------------------------------------------ products
async function renderProducts() {
  await loadLists();
  view.innerHTML = `
    <div class="bar"><h1>Products & Price Lists</h1>
      <div class="actions"><input id="psearch" class="search" placeholder="Search products">
      <button class="primary" id="padd">+ Add Product</button></div></div>
    <div class="table-wrap"><table class="items stack">
      <thead><tr id="phead"></tr></thead>
      <tbody id="plist"></tbody></table></div>`;
  const cols = [["code", "text", 80, "Code"], ["name", "text", 170, "Product Name (on bill)"], ["category", "text", 140, "Category"],
                ["hsn", "text", 95, "HSN/SAC"], ["unit", "text", 60, "Per"], ["price_internal", "number", 90, "Internal Rate"],
                ["price_external", "number", 90, "External Rate"], ["price_other", "number", 90, "Other Rate"],
                ["units_per_box", "number", 70, "Units/Box"], ["mrp", "number", 80, "Box MRP"],
                ["size", "text", 200, "Size (catalogue)"], ["rating", "text", 90, "Rating / Injury Size"]];
  $("#phead").innerHTML = cols.map(c => `<th>${c[3]}</th>`).join("") + "<th></th>";
  const rowHtml = p => `<tr data-id="${p.id || ""}" data-q="${esc((p.code + " " + p.name + " " + p.category).toLowerCase())}">
    ${cols.map(([k, t, w, label]) => `<td data-label="${label}"><input data-k="${k}" type="${t}" step="any"
      ${t === "number" ? 'inputmode="decimal"' : ""} style="min-width:${w}px" value="${esc(p[k])}"></td>`).join("")}
    <td class="full"><div class="actions"><button class="small primary save">Save</button><button class="small danger del">Delete</button></div></td></tr>`;
  const wire = tr => {
    $(".save", tr).onclick = async () => {
      const d = {};
      $$("[data-k]", tr).forEach(i => (d[i.dataset.k] = i.type === "number" ? (i.value === "" ? null : +i.value) : i.value));
      try {
        if (tr.dataset.id) await api(`${BASE}/api/products/${tr.dataset.id}`, { method: "PUT", body: d });
        else tr.dataset.id = (await api(BASE + "/api/products", { method: "POST", body: d })).id;
        toast("Product saved");
      } catch (e) { toast(e.message, true); }
    };
    $(".del", tr).onclick = async () => {
      if (tr.dataset.id) {
        if (!confirm("Delete this product?")) return;
        await api(`${BASE}/api/products/${tr.dataset.id}`, { method: "DELETE" });
      }
      tr.remove();
    };
  };
  $("#plist").innerHTML = PRODUCTS.map(rowHtml).join("");
  $$("#plist tr").forEach(wire);
  $("#padd").onclick = () => {
    $("#plist").insertAdjacentHTML("afterbegin", rowHtml({ hsn: "40169310", unit: "unit" }));
    wire($("#plist tr")); $("#plist tr [data-k=code]").focus();
  };
  $("#psearch").oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    $$("#plist tr").forEach(tr => (tr.style.display = !q || !tr.dataset.q || tr.dataset.q.includes(q) ? "" : "none"));
  };
}

// ------------------------------------------------------------------ website enquiries
const ENQ_STATUS = { new: "New", contacted: "Contacted", closed: "Closed" };

async function renderEnquiries() {
  const list = await api(BASE + "/api/enquiries");
  view.innerHTML = `<div class="bar"><h1>Website Enquiries</h1>
      <input id="esearch" class="search" placeholder="Search name, phone or city"></div>
    <div class="hint" style="margin-bottom:10px">Enquiries and distributor applications sent from the website contact forms.</div>
    ${list.length ? `<div class="table-wrap"><table class="stack">
      <thead><tr><th>Received</th><th>Type</th><th>Name</th><th>Phone</th><th>City</th><th>Products / Area</th><th>Message</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(e => `<tr data-id="${e.id}" data-q="${esc((e.name + " " + e.phone + " " + e.city + " " + e.company).toLowerCase())}">
        <td data-label="Received">${esc(fmtDate(e.created_at.slice(0, 10)))}</td>
        <td data-label="Type">${e.kind === "distributor" ? "<b>Distributor</b>" : "Enquiry"}</td>
        <td data-label="Name"><b>${esc(e.name)}</b>${e.company ? `<br><span class="hint">${esc(e.company)}</span>` : ""}</td>
        <td data-label="Phone"><a href="tel:${esc(e.phone)}">${esc(e.phone)}</a>
          ${e.email ? `<br><a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : ""}</td>
        <td data-label="City">${esc(e.city)}</td>
        <td data-label="Products / Area">${esc(e.products)}</td>
        <td class="full" data-label="Message">${esc(e.message)}</td>
        <td data-label="Status"><select class="e-status">${Object.entries(ENQ_STATUS).map(([k, v]) =>
          `<option value="${k}" ${k === e.status ? "selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="full"><div class="actions">
          <a class="btn small" target="_blank" href="https://wa.me/${waNumber(e.phone)}?text=${encodeURIComponent(`Hello ${e.name}, thank you for contacting NEU-TECH (Omkar Industries).`)}">WhatsApp</a>
          <button class="small danger e-del">Delete</button></div></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="card empty">No enquiries yet. Enquiries from the website contact and distributor forms appear here.</div>`}`;
  $$("tbody tr").forEach(tr => {
    $(".e-status", tr).onchange = async e => {
      await api(`${BASE}/api/enquiries/${tr.dataset.id}`, { method: "PUT", body: { status: e.target.value } });
      toast("Status updated");
      refreshEnquiryCount();
    };
    $(".e-del", tr).onclick = async () => {
      if (!confirm("Delete this enquiry?")) return;
      await api(`${BASE}/api/enquiries/${tr.dataset.id}`, { method: "DELETE" });
      tr.remove();
      refreshEnquiryCount();
    };
  });
  const s = $("#esearch");
  s.oninput = () => $$("tbody tr").forEach(tr => (tr.style.display = tr.dataset.q.includes(s.value.trim().toLowerCase()) ? "" : "none"));
}

function waNumber(phone) {
  let p = String(phone || "").split(/[\/,]/)[0].replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return p;
}

async function refreshEnquiryCount() {
  const n = (await api(BASE + "/api/bootstrap")).new_enquiries;
  const el = $("#enq-count");
  el.hidden = !n;
  el.textContent = n;
}

// ------------------------------------------------------------------ clients
async function renderClients() {
  await loadLists();
  view.innerHTML = `<div class="bar"><h1>Clients</h1><input id="csearch" class="search" placeholder="Search clients"></div>
    <div class="hint" style="margin-bottom:10px">Clients are added automatically when you save a bill.</div>
    ${CLIENTS.length ? `<div class="table-wrap"><table class="items stack">
      <thead><tr><th>Name</th><th>GSTIN</th><th>State</th><th>Mobile</th><th>E-mail</th><th>Address</th><th></th></tr></thead>
      <tbody>${CLIENTS.map(c => `<tr data-id="${c.id}" data-q="${esc(c.name.toLowerCase())}">
        <td class="full" data-label="Name"><input data-k="name" value="${esc(c.name)}" style="min-width:160px"></td>
        <td data-label="GSTIN"><input data-k="gstin" value="${esc(c.gstin)}" style="min-width:140px"></td>
        <td data-label="State"><select data-k="state_code" style="min-width:140px">${stateOptions(c.state_code)}</select></td>
        <td data-label="Mobile"><input data-k="phone" type="tel" value="${esc(c.phone)}" style="min-width:110px"></td>
        <td data-label="E-mail"><input data-k="email" type="email" value="${esc(c.email)}" style="min-width:160px"></td>
        <td class="full" data-label="Address"><textarea data-k="address" rows="2" style="min-width:220px">${esc(c.address)}</textarea></td>
        <td class="full"><div class="actions"><button class="small primary save">Save</button><button class="small danger del">Delete</button></div></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="card empty">No clients yet.</div>`}`;
  $$("tbody tr").forEach(tr => {
    $(".save", tr).onclick = async () => {
      const d = {};
      $$("[data-k]", tr).forEach(i => (d[i.dataset.k] = i.value));
      d.state = stateName(d.state_code);
      await api(`${BASE}/api/clients/${tr.dataset.id}`, { method: "PUT", body: d });
      toast("Client saved");
    };
    $(".del", tr).onclick = async () => {
      if (!confirm("Delete this client? Existing bills are not changed.")) return;
      await api(`${BASE}/api/clients/${tr.dataset.id}`, { method: "DELETE" });
      tr.remove();
    };
  });
  const s = $("#csearch");
  s.oninput = () => $$("tbody tr").forEach(tr => (tr.style.display = tr.dataset.q.includes(s.value.trim().toLowerCase()) ? "" : "none"));
}

// ------------------------------------------------------------------ settings
async function renderSettings() {
  BOOT = await api(BASE + "/api/bootstrap");
  const S = BOOT.settings;
  const companyCard = c => {
    const fld = (k, label, wide) => `<div class="${wide ? "wide" : ""}"><label>${label}</label>
      ${k === "address" ? `<textarea data-k="address" rows="3">${esc(c.address)}</textarea>` : `<input data-k="${k}" value="${esc(c[k])}">`}</div>`;
    return `<div class="card company" data-id="${c.id}">
      <div class="bar"><h2 style="margin:0">${esc(c.name)}</h2>
        ${c.kind === "other" ? `<button class="small danger del">Delete</button>` : ""}</div>
      <div class="grid">
        ${fld("name", "Company Name")}${fld("gstin", "GSTIN/UIN")}
        <div><label>State</label><select data-k="state_code">${stateOptions(c.state_code)}</select></div>
        ${fld("phone", "Mobile No.")}${fld("email", "E-mail")}${fld("pan", "PAN")}
        ${fld("address", "Address", true)}
        ${fld("bank_holder", "A/c Holder's Name")}${fld("bank_name", "Bank Name")}${fld("bank_account", "A/c No.")}
        ${fld("bank_branch", "Branch")}${fld("bank_ifsc", "IFSC Code")}
        <div><label>UPI ID (for payment QR code)</label><input data-k="upi_id" placeholder="name@sbi" value="${esc(c.upi_id)}"></div>
        ${c.kind !== "other" ? `<div><label>Invoice Prefix</label><input data-k="invoice_prefix" value="${esc(c.invoice_prefix)}">
          <div class="hint">Bill no. will be ${esc(c.invoice_prefix || "PREFIX")}/YY-YY/your number</div></div>` : ""}
        <div><label>Logo (shown on the bill)</label>
          ${c.logo ? `<img class="logo-preview" src="/static/logos/${esc(c.logo)}?${Date.now()}">` : ""}
          <input type="file" accept="image/*" class="logo"></div>
      </div>
      <div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="primary save">Save</button></div></div>`;
  };
  view.innerHTML = `<h1>Settings</h1>
    <div class="card"><h2>Bill Settings</h2><div class="grid">
      <div><label>Default IGST %</label><input id="s-igst" type="number" step="any" value="${esc(S.default_igst)}"></div>
      <div><label>Default CGST %</label><input id="s-cgst" type="number" step="any" value="${esc(S.default_cgst)}"></div>
      <div><label>Default SGST %</label><input id="s-sgst" type="number" step="any" value="${esc(S.default_sgst)}"></div>
      <div><label>e-Way Bill required above (₹)</label><input id="s-eway" type="number" step="any" value="${esc(S.eway_threshold)}">
        <div class="hint">GST rule: ₹ 50,000 (bill value including GST).</div></div>
      <div class="wide"><label>Terms & Conditions (printed on every bill)</label><textarea id="s-terms" rows="5">${esc(S.terms)}</textarea></div>
    </div><div class="actions" style="justify-content:flex-end;margin-top:12px"><button class="primary" id="s-save">Save</button></div></div>
    <div class="card"><h2>Secret Billing Address</h2>
      <p class="hint" style="margin-top:0">Billing opens only at this address. It is not linked anywhere and does not show in search engines.
        Keep it private, like a password. Bookmark it after changing.</p>
      <div class="grid">
        <div class="wide"><label>Address</label><div class="prefix-input"><span>${esc(location.origin)}</span>
          <input id="adm-path" value="${esc(BOOT.admin_path)}" autocomplete="off" spellcheck="false"></div></div>
      </div>
      <div class="actions" style="justify-content:flex-end;margin-top:12px">
        <button id="adm-random">Suggest a random one</button><button class="primary" id="adm-save">Change Address</button></div></div>
    <div class="card"><h2>Change Billing Password</h2><div class="grid">
      <div><label>Current password</label><input id="pw-cur" type="password" autocomplete="current-password"></div>
      <div><label>New password (min. 10 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
    </div><div class="actions" style="justify-content:flex-end;margin-top:12px"><button id="pw-save">Change Password</button></div></div>
    <h1 style="margin-top:24px">Companies (From)</h1>
    ${BOOT.companies.map(companyCard).join("")}`;

  $("#s-save").onclick = async () => {
    await api(BASE + "/api/settings", { method: "PUT", body: { default_igst: $("#s-igst").value, default_cgst: $("#s-cgst").value,
                                                        default_sgst: $("#s-sgst").value, terms: $("#s-terms").value,
                                                        eway_threshold: $("#s-eway").value || 50000 } });
    BOOT = await api(BASE + "/api/bootstrap");
    toast("Settings saved");
  };
  $("#adm-random").onclick = () => {
    const a = new Uint8Array(5);
    crypto.getRandomValues(a);
    $("#adm-path").value = "/office-" + [...a].map(b => b.toString(36).padStart(2, "0")).join("").slice(0, 8);
  };
  $("#adm-save").onclick = async () => {
    const path = $("#adm-path").value.trim();
    if (path === BOOT.admin_path) return toast("That is already the address");
    if (!confirm(`Billing will move to:\n${location.origin}${path.startsWith("/") ? path : "/" + path}\n\nThe old address will stop working. Continue?`)) return;
    try {
      const r = await api(BASE + "/api/admin-path", { method: "PUT", body: { path } });
      location.href = r.path + "#/settings";
    } catch (e) { toast(e.message, true); }
  };
  $("#pw-save").onclick = async () => {
    try {
      await api(BASE + "/api/password", { method: "PUT", body: { current: $("#pw-cur").value, new: $("#pw-new").value } });
      $("#pw-cur").value = $("#pw-new").value = "";
      toast("Password changed");
    } catch (e) { toast(e.message, true); }
  };
  $$(".company").forEach(card => {
    const id = card.dataset.id;
    $(".save", card).onclick = async () => {
      const d = {};
      $$("[data-k]", card).forEach(i => (d[i.dataset.k] = i.value));
      d.state = stateName(d.state_code);
      try {
        await api(`${BASE}/api/companies/${id}`, { method: "PUT", body: d });
        const f = $(".logo", card).files[0];
        if (f) { const fd = new FormData(); fd.append("logo", f); await api(`${BASE}/api/companies/${id}/logo`, { method: "POST", body: fd }); }
        toast("Company saved");
        renderSettings();
      } catch (e) { toast(e.message, true); }
    };
    const del = $(".del", card);
    if (del) del.onclick = async () => {
      if (!confirm("Delete this company? Existing bills are not changed.")) return;
      await api(`${BASE}/api/companies/${id}`, { method: "DELETE" });
      renderSettings();
    };
  });
}

// ------------------------------------------------------------------ start
(async () => {
  BOOT = await api(BASE + "/api/bootstrap");
  $("#enq-count").hidden = !BOOT.new_enquiries;
  $("#enq-count").textContent = BOOT.new_enquiries;
  window.addEventListener("hashchange", route);
  route();
})();
