// Billing at the secret address: login / setup pages and the billing API (/<secret>/api/...).
import { adminPath, changeAdminPath, clearCookie, isLoggedIn, sessionCookie, setPassword, verifyPassword } from "./auth.js";
import { BILL_TYPES, PRICE_LISTS, STATES, calculate, ewayRequired, financialYear, num } from "./billing.js";
import {
  BACKUP_TABLES, CLIENT_FIELDS, COMPANY_FIELDS, PRODUCT_FIELDS, SECRET_SETTINGS, addHit, all, clean, clearHits, countHits,
  deleteFile, first, getFile, getSetting, hasFile, insertStmt, logActivity, parseInvoice, putFile, run, setSetting, updateStmt,
} from "./db.js";
import { buildEwayJson } from "./ewaybill.js";
import { clientIp, fail, html, json, readJson, redirect, sleep, todayIST } from "./http.js";
import { invoicePdf } from "./invoice-pdf.js";
import { billingPage, loginPage } from "./views.js";

const AUTO_NUMBERED = ["pi_excl", "pi_incl", "other"];
const LOCK_AFTER = 5, LOCK_SECONDS = 15 * 60;
const MAX_FILE = 1900000; // D1 stores up to ~2 MB per value

export async function handleBilling(ctx, base, sub) {
  const { request, env } = ctx;
  const secure = new URL(request.url).protocol === "https:";
  const hasPassword = !!(await getSetting(env, "admin_password_hash"));

  if (sub === "/setup") return setupPage(request, env, base, secure, hasPassword);
  if (sub === "/login") return loginRoute(request, env, base, secure, hasPassword);
  if (sub === "/logout") return redirect(`${base}/login`, 302, { "Set-Cookie": clearCookie(secure) });

  const loggedIn = hasPassword && (await isLoggedIn(request, env));
  if (sub.startsWith("/api/")) {
    if (!loggedIn) return fail("Please log in again", 401);
    try {
      return (await api(request, env, sub.slice(4), secure)) || fail("Not found", 404);
    } catch (err) {
      console.error(err);
      return fail("Something went wrong. Please try again.", 500);
    }
  }
  if (sub === "/" || sub === "") {
    if (!loggedIn) return redirect(hasPassword ? `${base}/login` : `${base}/setup`);
    return html(billingPage(base));
  }
  return null; // unknown page under the secret address: normal 404
}

async function setupPage(request, env, base, secure, hasPassword) {
  if (hasPassword) return redirect(`${base}/login`);
  if (!env.SETUP_CODE) {
    return html(loginPage({ mode: "setup", blocked: true,
      error: "Add a SETUP_CODE environment variable in Cloudflare Pages settings, redeploy, then reload this page." }));
  }
  let error = "";
  if (request.method === "POST") {
    const f = await request.formData();
    const ip = clientIp(request);
    const pw = String(f.get("password") || ""), pw2 = String(f.get("password2") || "");
    if ((await countHits(env, "setup", ip, LOCK_SECONDS)) >= LOCK_AFTER) {
      error = "Too many wrong attempts. Try again in 15 minutes.";
    } else if (String(f.get("code") || "").trim() !== env.SETUP_CODE) {
      await addHit(env, "setup", ip);
      await sleep(1000);
      error = "Wrong setup code.";
    } else if (pw.length < 10) {
      error = "Use at least 10 characters.";
    } else if (pw !== pw2) {
      error = "The two passwords do not match.";
    } else {
      await setPassword(env, pw);
      return redirect(base, 302, { "Set-Cookie": await sessionCookie(env, secure) });
    }
  }
  return html(loginPage({ mode: "setup", error }));
}

async function loginRoute(request, env, base, secure, hasPassword) {
  if (!hasPassword) return redirect(`${base}/setup`);
  let error = "";
  if (request.method === "POST") {
    const ip = clientIp(request);
    const f = await request.formData();
    const fails = await countHits(env, "login", ip, LOCK_SECONDS);
    if (fails >= LOCK_AFTER) {
      error = "Too many wrong attempts. Try again in 15 minutes.";
    } else if (await verifyPassword(String(f.get("password") || ""), await getSetting(env, "admin_password_hash"))) {
      await clearHits(env, "login", ip);
      return redirect(base, 302, { "Set-Cookie": await sessionCookie(env, secure) });
    } else {
      await addHit(env, "login", ip);
      await sleep(1000); // slows down password guessing
      const left = LOCK_AFTER - fails - 1;
      error = left > 0 ? `Wrong password. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Try again in 15 minutes.";
    }
  }
  return html(loginPage({ mode: "login", error }));
}

// ------------------------------------------------------------------ API
async function api(request, env, path, secure) {
  const m = request.method;
  const url = new URL(request.url);
  let r;

  if (path === "/bootstrap" && m === "GET") return bootstrap(env);
  if (path === "/password" && m === "PUT") return changePassword(request, env, secure);
  if (path === "/admin-path" && m === "PUT") {
    const [p, err] = await changeAdminPath(env, (await readJson(request)).path);
    if (!err) await logActivity(env, "update", "settings", null, "Changed the secret billing address");
    return err ? fail(err) : json({ path: p });
  }
  if (path === "/settings" && m === "PUT") {
    const d = await readJson(request);
    const allowed = ["terms", "default_igst", "default_cgst", "default_sgst", "eway_threshold"];
    await env.DB.batch(Object.entries(d).filter(([k]) => allowed.includes(k))
      .map(([k, v]) => env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(k, String(v))));
    await logActivity(env, "update", "settings", null, "Saved bill settings");
    return json({ ok: true });
  }

  // companies
  if (path === "/companies" && m === "POST") {
    const d = clean(await readJson(request), COMPANY_FIELDS);
    if (!d.name) return fail("Company name is required");
    const res = await insertStmt(env.DB, "companies", { kind: "other", ...d }).run();
    await logActivity(env, "create", "companies", res.meta.last_row_id, `Added company ${d.name}`);
    return json(await first(env, "SELECT * FROM companies WHERE id=?", res.meta.last_row_id));
  }
  if ((r = path.match(/^\/companies\/(\d+)$/))) {
    const id = Number(r[1]);
    if (m === "PUT") {
      const d = clean(await readJson(request), COMPANY_FIELDS);
      if (!d.name) return fail("Company name is required");
      const before = await first(env, "SELECT * FROM companies WHERE id=?", id);
      await updateStmt(env.DB, "companies", d, "id=?", id).run();
      await logActivity(env, "update", "companies", id, `Updated company ${d.name}`, before);
      return json(await first(env, "SELECT * FROM companies WHERE id=?", id));
    }
    if (m === "DELETE") {
      const c = await first(env, "SELECT * FROM companies WHERE id=?", id);
      if (c && c.kind !== "other") return fail("Omkar Industries and Shree Siddhivinayak Industries cannot be deleted");
      await run(env, "DELETE FROM companies WHERE id=?", id);
      if (c) await logActivity(env, "delete", "companies", id, `Deleted company ${c.name}`, c);
      return json({ ok: true });
    }
  }
  if ((r = path.match(/^\/companies\/(\d+)\/logo$/))) {
    const id = Number(r[1]);
    if (m === "GET") {
      const f = await getFile(env, `logo:${id}`);
      return f ? new Response(f.data, { headers: { "Content-Type": f.type, "Cache-Control": "no-store" } }) : fail("Not found", 404);
    }
    if (m === "POST") {
      const f = (await request.formData()).get("logo");
      if (!f || typeof f === "string") return fail("No file uploaded");
      const bytes = new Uint8Array(await f.arrayBuffer());
      const png = bytes[0] === 0x89 && bytes[1] === 0x50, jpg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!png && !jpg) return fail("Use a PNG or JPG image");
      if (bytes.length > MAX_FILE) return fail("Image is too large (max 1.9 MB)");
      await putFile(env, `logo:${id}`, png ? "image/png" : "image/jpeg", bytes);
      await run(env, "UPDATE companies SET logo='db' WHERE id=?", id);
      await logActivity(env, "update", "companies", id, "Uploaded a new logo");
      return json({ logo: "db" });
    }
  }

  // clients
  if (path === "/clients" && m === "GET") return json(await all(env, "SELECT * FROM clients ORDER BY name"));
  if ((r = path.match(/^\/clients\/(\d+)$/))) {
    const id = Number(r[1]);
    const before = await first(env, "SELECT * FROM clients WHERE id=?", id);
    if (m === "PUT") {
      const d = clean(await readJson(request), CLIENT_FIELDS);
      await updateStmt(env.DB, "clients", d, "id=?", id).run();
      await logActivity(env, "update", "clients", id, `Updated client ${d.name || ""}`, before);
      return json({ ok: true });
    }
    if (m === "DELETE") {
      await run(env, "DELETE FROM clients WHERE id=?", id);
      if (before) await logActivity(env, "delete", "clients", id, `Deleted client ${before.name}`, before);
      return json({ ok: true });
    }
  }

  // products
  if (path === "/products" && m === "GET") return json(await all(env, "SELECT * FROM products ORDER BY id"));
  if (path === "/products" && m === "POST") {
    const d = clean(await readJson(request), PRODUCT_FIELDS);
    if (!d.name) return fail("Product name is required");
    d.hsn = d.hsn || "40169310";
    d.unit = d.unit || "unit";
    if (await first(env, "SELECT 1 AS x FROM products WHERE name=?", d.name)) return fail("A product with this name already exists");
    const res = await insertStmt(env.DB, "products", d).run();
    await logActivity(env, "create", "products", res.meta.last_row_id, `Added product ${d.name}`);
    return json(await first(env, "SELECT * FROM products WHERE id=?", res.meta.last_row_id));
  }
  if ((r = path.match(/^\/products\/(\d+)$/))) {
    const id = Number(r[1]);
    if (m === "PUT") {
      const d = clean(await readJson(request), PRODUCT_FIELDS);
      if (!d.name) return fail("Product name is required");
      if (await first(env, "SELECT 1 AS x FROM products WHERE name=? AND id<>?", d.name, id)) {
        return fail("A product with this name already exists");
      }
      const before = await first(env, "SELECT * FROM products WHERE id=?", id);
      await updateStmt(env.DB, "products", d, "id=?", id).run();
      await logActivity(env, "update", "products", id, `Updated product ${d.name}`, before);
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const before = await first(env, "SELECT * FROM products WHERE id=?", id);
      await run(env, "DELETE FROM products WHERE id=?", id);
      if (before) await logActivity(env, "delete", "products", id, `Deleted product ${before.name}`, before);
      return json({ ok: true });
    }
  }

  // website enquiries
  if (path === "/enquiries" && m === "GET") return json(await all(env, "SELECT * FROM enquiries ORDER BY id DESC"));
  if ((r = path.match(/^\/enquiries\/(\d+)$/))) {
    if (m === "PUT") {
      const status = (await readJson(request)).status;
      if (!["new", "contacted", "closed"].includes(status)) return fail("Unknown status");
      await run(env, "UPDATE enquiries SET status=? WHERE id=?", status, Number(r[1]));
      await logActivity(env, "update", "enquiries", Number(r[1]), `Marked enquiry as ${status}`);
      return json({ ok: true });
    }
    if (m === "DELETE") {
      const before = await first(env, "SELECT * FROM enquiries WHERE id=?", Number(r[1]));
      await run(env, "DELETE FROM enquiries WHERE id=?", Number(r[1]));
      if (before) await logActivity(env, "delete", "enquiries", before.id, `Deleted enquiry from ${before.name}`, before);
      return json({ ok: true });
    }
  }

  // backup, restore and activity
  if (path === "/backup" && m === "GET") return backup(env);
  if (path === "/restore" && m === "POST") return restore(env, request);
  if (path === "/activity" && m === "GET") {
    return json(await all(env, "SELECT id, at, action, entity, entity_id, summary, data<>'' AS has_data FROM activity ORDER BY id DESC LIMIT 200"));
  }
  if ((r = path.match(/^\/activity\/(\d+)\/undo$/)) && m === "POST") return undoDelete(env, Number(r[1]));

  // invoices
  if (path === "/next-number" && m === "GET") return nextNumber(env, url);
  if (path === "/invoices" && m === "GET") return listInvoices(env, url.searchParams.get("bill_type"));
  if (path === "/invoices" && m === "POST") return saveInvoice(env, await readJson(request));
  if ((r = path.match(/^\/invoices\/(\d+)(\/[a-z-]+)?$/))) {
    const id = Number(r[1]), action = r[2] || "";
    if (!action && m === "GET") return getInvoice(env, id);
    if (!action && m === "PUT") return saveInvoice(env, await readJson(request), id);
    if (!action && m === "DELETE") {
      const before = await first(env, "SELECT * FROM invoices WHERE id=?", id);
      await run(env, "DELETE FROM invoices WHERE id=?", id);
      // the e-Way Bill PDF is kept so the bill can be fully recovered from the activity log
      if (before) await logActivity(env, "delete", "invoices", id, `Deleted bill ${before.invoice_no}`, before);
      return json({ ok: true });
    }
    if (action === "/pdf" && m === "GET") return pdfRoute(request, env, id, url);
    if (action === "/ewb-json" && m === "GET") return ewbJson(env, id);
    if (action === "/ewb-pdf") return ewbPdf(request, env, id, url);
    if (action === "/eway" && m === "PUT") return setEway(env, id, await readJson(request));
  }
  return null;
}

async function bootstrap(env) {
  const settings = {};
  for (const s of await all(env, "SELECT key, value FROM settings")) {
    if (!["admin_password_hash", "session_secret", "auth_version"].includes(s.key)) settings[s.key] = s.value;
  }
  return json({
    companies: await all(env, "SELECT * FROM companies ORDER BY id"),
    settings,
    new_enquiries: (await first(env, "SELECT COUNT(*) AS n FROM enquiries WHERE status='new'")).n,
    admin_path: await adminPath(env),
    bill_types: BILL_TYPES, price_lists: PRICE_LISTS, states: STATES, today: todayIST(),
  });
}

async function changePassword(request, env, secure) {
  const d = await readJson(request);
  if (!(await verifyPassword(String(d.current || ""), await getSetting(env, "admin_password_hash")))) {
    await sleep(1000);
    return fail("Current password is wrong");
  }
  if (String(d.new || "").length < 10) return fail("Use at least 10 characters");
  await setPassword(env, String(d.new));
  await logActivity(env, "update", "settings", null, "Changed the billing password");
  // keep this device signed in, sign out all others
  return json({ ok: true }, 200, { "Set-Cookie": await sessionCookie(env, secure) });
}

// ---- invoice helpers
async function nextAutoNumber(env, billType) {
  const rows = await all(env, "SELECT invoice_no FROM invoices WHERE bill_type=?", billType);
  const nums = rows.map(r => r.invoice_no).filter(n => /^\d+$/.test(n)).map(Number);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

const companyPrefix = (company, date) =>
  `${company.invoice_prefix || company.name.split(/\s+/)[0].toUpperCase()}/${financialYear(date)}/`;

async function nextNumber(env, url) {
  const billType = url.searchParams.get("bill_type");
  const date = url.searchParams.get("date") || todayIST();
  if (AUTO_NUMBERED.includes(billType)) return json({ number: await nextAutoNumber(env, billType) });
  const company = await first(env, "SELECT * FROM companies WHERE kind=?", billType);
  if (!company) return fail("Unknown bill type");
  const prefix = companyPrefix(company, date);
  const last = await first(env, "SELECT invoice_no FROM invoices WHERE bill_type=? AND invoice_no LIKE ? ORDER BY id DESC LIMIT 1",
    billType, prefix + "%");
  return json({ prefix, last: last ? last.invoice_no : null });
}

async function ewayThreshold(env) {
  return num(await getSetting(env, "eway_threshold"), 50000);
}

function ewayStatus(inv, threshold) {
  const required = ewayRequired(inv.bill_type, inv.grand_total, threshold);
  return { eway_required: required, eway_pending: required && !(inv.details || {}).eway_bill_no };
}

function cleanEway(details) {
  const no = String(details.eway_bill_no || "").replace(/\s+/g, "");
  details.eway_bill_no = no;
  return no && !/^\d{12}$/.test(no) ? "e-Way Bill number must be 12 digits" : null;
}

async function loadInvoice(env, id) {
  const row = await first(env, "SELECT * FROM invoices WHERE id=?", id);
  return row ? parseInvoice(row) : null;
}

async function listInvoices(env, billType) {
  const threshold = await ewayThreshold(env);
  const rows = await all(env, "SELECT id, bill_type, invoice_no, date, buyer, seller, details, subtotal, tax_total, grand_total " +
    "FROM invoices WHERE bill_type=? ORDER BY date DESC, id DESC", billType);
  const invoices = rows.map(row => {
    const inv = parseInvoice(row);
    const out = { id: inv.id, bill_type: inv.bill_type, invoice_no: inv.invoice_no, date: inv.date, subtotal: inv.subtotal,
      tax_total: inv.tax_total, grand_total: inv.grand_total, client: inv.buyer.name || "", from: inv.seller.name || "" };
    return { ...out, ...ewayStatus(inv, threshold) };
  });
  const counts = {};
  for (const c of await all(env, "SELECT bill_type, COUNT(*) AS n FROM invoices GROUP BY bill_type")) counts[c.bill_type] = c.n;
  return json({ invoices, counts });
}

async function getInvoice(env, id) {
  const inv = await loadInvoice(env, id);
  if (!inv) return fail("Bill not found", 404);
  const threshold = await ewayThreshold(env);
  return json({ ...inv, ...ewayStatus(inv, threshold), eway_threshold: threshold, has_ewb_pdf: await hasFile(env, `ewb:${id}`) });
}

async function upsertClient(env, buyer) {
  const d = clean(buyer, CLIENT_FIELDS);
  if (!d.name) return;
  if (await first(env, "SELECT 1 AS x FROM clients WHERE name=?", d.name)) {
    // only overwrite fields that were filled in, so a bill with a partial address never wipes saved details
    const filled = Object.fromEntries(Object.entries(d).filter(([, v]) => v));
    await updateStmt(env.DB, "clients", filled, "name=?", d.name).run();
  } else {
    await insertStmt(env.DB, "clients", d).run();
  }
}

async function saveInvoice(env, data, id = null) {
  const billType = data.bill_type;
  if (!BILL_TYPES[billType]) return fail("Select a bill format");
  if (!PRICE_LISTS[data.price_list]) return fail("Select a price list");
  const date = data.date || todayIST();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Invalid date");
  const buyer = clean(data.buyer || {}, CLIENT_FIELDS);
  if (!buyer.name) return fail("Enter the client (Bill To) name");
  const details = data.details && typeof data.details === "object" ? data.details : {};
  const err = cleanEway(details);
  if (err) return fail(err);

  // From (seller)
  let company;
  if (billType === "omkar" || billType === "ssi") {
    company = await first(env, "SELECT * FROM companies WHERE kind=?", billType);
  } else if (data.company_id === "new") {
    const nc = clean(data.new_company || {}, COMPANY_FIELDS);
    if (!nc.name) return fail("Enter the From company name");
    const res = await insertStmt(env.DB, "companies", { kind: "other", ...nc }).run();
    company = await first(env, "SELECT * FROM companies WHERE id=?", res.meta.last_row_id);
  } else {
    company = await first(env, "SELECT * FROM companies WHERE id=?", Number(data.company_id) || 0);
    if (!company) return fail("Select the From company");
  }

  // Invoice number
  let invoiceNo;
  if (billType === "omkar" || billType === "ssi") {
    const suffix = String(data.invoice_suffix || "").trim();
    if (!suffix) return fail("Enter the invoice number (the part after the prefix)");
    invoiceNo = companyPrefix(company, date) + suffix;
  } else {
    invoiceNo = String(data.invoice_no || "").trim() || (await nextAutoNumber(env, billType));
  }
  if (await first(env, "SELECT 1 AS x FROM invoices WHERE bill_type=? AND invoice_no=? AND id<>?", billType, invoiceNo, id || 0)) {
    return fail(`Invoice number ${invoiceNo} already exists for this bill type`, 409);
  }

  const inv = {
    bill_type: billType, price_list: data.price_list, invoice_no: invoiceNo, date, company_id: company.id, seller: company, buyer,
    tax_mode: ["igst", "cgst_sgst"].includes(data.tax_mode) ? data.tax_mode : "none",
    igst_rate: num(data.igst_rate), cgst_rate: num(data.cgst_rate), sgst_rate: num(data.sgst_rate), qty_pct: data.qty_pct,
    items: Array.isArray(data.items) ? data.items : [], details,
  };
  calculate(inv);
  if (!inv.items.length) return fail("Add at least one product");

  await upsertClient(env, buyer);
  const cols = ["bill_type", "price_list", "invoice_no", "date", "company_id", "seller", "buyer", "tax_mode", "igst_rate", "cgst_rate",
    "sgst_rate", "qty_pct", "items", "details", "subtotal", "tax_total", "round_off", "grand_total"];
  const row = Object.fromEntries(cols.map(k => [k, ["seller", "buyer", "items", "details"].includes(k) ? JSON.stringify(inv[k]) : inv[k]]));
  if (id) {
    const before = await first(env, "SELECT * FROM invoices WHERE id=?", id);
    await env.DB.prepare(`UPDATE invoices SET ${cols.map(k => `${k}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(...cols.map(k => row[k]), id).run();
    await logActivity(env, "update", "invoices", id, `Edited bill ${invoiceNo}`, before);
  } else {
    id = (await insertStmt(env.DB, "invoices", row).run()).meta.last_row_id;
    await logActivity(env, "create", "invoices", id, `Created bill ${invoiceNo} for ${buyer.name} (Rs. ${inv.grand_total})`);
  }
  return json({ id, invoice_no: invoiceNo, ...ewayStatus(inv, await ewayThreshold(env)) });
}

async function logoBytes(env, request, seller) {
  if (!seller.logo) return null;
  if (seller.logo === "db") return (await getFile(env, `logo:${seller.id}`))?.data || null;
  if (!/^[\w.-]+$/.test(seller.logo) || !env.ASSETS) return null;
  const res = await env.ASSETS.fetch(new URL(`/static/logos/${seller.logo}`, request.url));
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}

async function pdfRoute(request, env, id, url) {
  const inv = await loadInvoice(env, id);
  if (!inv) return fail("Bill not found", 404);
  calculate(inv);
  const terms = (await getSetting(env, "terms")) || "";
  const bytes = await invoicePdf(inv, terms, { copies: url.searchParams.get("copies") === "all" ? "all" : "original",
    logoBytes: await logoBytes(env, request, inv.seller) });
  const fname = `${inv.invoice_no}_${inv.buyer.name || ""}`.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") + ".pdf";
  return new Response(bytes, { headers: { "Content-Type": "application/pdf",
    "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${fname}"` } });
}

async function ewbJson(env, id) {
  const inv = await loadInvoice(env, id);
  if (!inv) return fail("Bill not found", 404);
  calculate(inv);
  const [data, problems] = buildEwayJson(inv);
  return json({ data, problems, filename: `EWB_${inv.invoice_no}`.replace(/[^A-Za-z0-9_-]+/g, "_") + ".json" });
}

async function ewbPdf(request, env, id, url) {
  const key = `ewb:${id}`;
  if (request.method === "GET") {
    const f = await getFile(env, key);
    if (!f) return fail("Not found", 404);
    return new Response(f.data, { headers: { "Content-Type": "application/pdf",
      "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="e-Way-Bill-${id}.pdf"` } });
  }
  if (request.method === "DELETE") {
    await deleteFile(env, key);
    await logActivity(env, "update", "invoices", id, "Removed the attached e-Way Bill PDF");
    return json({ ok: true });
  }
  if (request.method !== "POST") return null;
  const form = await request.formData();
  const f = form.get("file");
  if (!f || typeof f === "string") return fail("Choose the e-Way Bill PDF");
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return fail("That file is not a PDF");
  if (bytes.length > MAX_FILE) return fail("File is too large (max 1.9 MB)");
  const inv = await loadInvoice(env, id);
  if (!inv) return fail("Bill not found", 404);
  await putFile(env, key, "application/pdf", bytes);
  await logActivity(env, "update", "invoices", id, `Attached e-Way Bill PDF to bill ${inv.invoice_no}`);
  // number and date read from the PDF in the browser (pdf.js); checked again here
  const found = {};
  const no = String(form.get("eway_bill_no") || "").replace(/\s+/g, "");
  if (/^\d{12}$/.test(no)) found.eway_bill_no = no;
  const date = String(form.get("eway_bill_date") || "");
  if (found.eway_bill_no && /^\d{4}-\d{2}-\d{2}$/.test(date)) found.eway_bill_date = date;
  if (found.eway_bill_no) {
    Object.assign(inv.details, found);
    await run(env, "UPDATE invoices SET details=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", JSON.stringify(inv.details), id);
  }
  return json({ ok: true, found });
}

async function setEway(env, id, body) {
  const data = { eway_bill_no: body.eway_bill_no, eway_bill_date: body.eway_bill_date || "" };
  const err = cleanEway(data);
  if (err || !data.eway_bill_no) return fail(err || "Enter the e-Way Bill number");
  const inv = await loadInvoice(env, id);
  if (!inv) return fail("Bill not found", 404);
  Object.assign(inv.details, data);
  await run(env, "UPDATE invoices SET details=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", JSON.stringify(inv.details), id);
  await logActivity(env, "update", "invoices", id, `Added e-Way Bill ${data.eway_bill_no} to bill ${inv.invoice_no}`);
  return json({ ok: true });
}

// ------------------------------------------------------------------ backup / restore
function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Everything in one file: all tables (without login secrets) and all uploaded files. */
async function backup(env) {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    let rows = await all(env, `SELECT * FROM ${t}`);
    if (t === "settings") rows = rows.filter(r => !SECRET_SETTINGS.includes(r.key));
    tables[t] = rows;
  }
  const files = (await all(env, "SELECT key, type, data FROM files"))
    .map(f => ({ key: f.key, type: f.type, data: toB64(new Uint8Array(f.data)) }));
  const today = todayIST();
  await setSetting(env, "last_backup_at", today);
  const body = JSON.stringify({ app: "neutech-billing", version: 1, created: new Date().toISOString(), tables, files });
  return new Response(body, { headers: { "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="neutech-backup-${today}.json"` } });
}

/** Replaces all data with the contents of a backup file. The login password and secret address stay as they are. */
async function restore(env, request) {
  const f = (await request.formData()).get("file");
  if (!f || typeof f === "string") return fail("Choose a backup file");
  let data;
  try { data = JSON.parse(await f.text()); } catch { return fail("That is not a backup file"); }
  if (data.app !== "neutech-billing" || !data.tables) return fail("That is not a NEU-TECH billing backup");
  const db = env.DB;
  const stmts = [];
  for (const t of BACKUP_TABLES) {
    const rows = data.tables[t];
    if (!Array.isArray(rows)) continue;
    if (t === "settings") {
      for (const r of rows) {
        if (!SECRET_SETTINGS.includes(r.key)) {
          stmts.push(db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(r.key, r.value));
        }
      }
      continue;
    }
    stmts.push(db.prepare(`DELETE FROM ${t}`));
    for (const r of rows) stmts.push(insertStmt(db, t, r));
  }
  if (Array.isArray(data.files)) {
    stmts.push(db.prepare("DELETE FROM files"));
    for (const fl of data.files) {
      stmts.push(db.prepare("INSERT INTO files (key, type, data) VALUES (?, ?, ?)").bind(fl.key, fl.type, fromB64(fl.data)));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  await logActivity(env, "restore", "backup", null, `Restored backup from ${String(data.created || "").slice(0, 10)}`);
  return json({ ok: true, counts: Object.fromEntries(BACKUP_TABLES.map(t => [t, (data.tables[t] || []).length])) });
}

/** Brings back a deleted bill, client, product, company or enquiry from the activity log. */
async function undoDelete(env, activityId) {
  const a = await first(env, "SELECT * FROM activity WHERE id=?", activityId);
  const allowed = ["invoices", "clients", "products", "companies", "enquiries"];
  if (!a || a.action !== "delete" || !allowed.includes(a.entity) || !a.data) return fail("This change cannot be undone");
  const row = JSON.parse(a.data);
  if (await first(env, `SELECT 1 AS x FROM ${a.entity} WHERE id=?`, row.id)) return fail("It has already been restored");
  try {
    await insertStmt(env.DB, a.entity, row).run();
  } catch {
    return fail("Could not restore: something with the same name or number exists now");
  }
  await logActivity(env, "restore", a.entity, row.id, `Restored: ${a.summary.replace(/^Deleted /, "")}`);
  return json({ ok: true });
}
