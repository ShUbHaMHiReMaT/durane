import json
import os
import re
import secrets
import sys
import time
from datetime import date, timedelta
from urllib.parse import urlparse

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, send_file, session
from PIL import Image
from werkzeug.security import check_password_hash, generate_password_hash

import billing
import db
import ewaybill
import pdfgen
import site_pages

app = Flask(__name__)
db.init()

# Hosting settings (environment variables):
#   BILLING_HTTPS=1     the site is served over HTTPS -> secure cookies and HSTS
#   BILLING_PROXY=1     the app runs behind a reverse proxy (nginx, Cloudflare...) -> trust X-Forwarded-* headers
#   BILLING_HOST/PORT   address to listen on
HTTPS = os.environ.get("BILLING_HTTPS") == "1"

# ---------------------------------------------------------------- secret billing address
# Billing is served only under a secret, unguessable address (e.g. /office-7qk2mz). Inside the app the routes
# stay /billing/... and /api/...; requests to those plain paths from outside get the normal "page not found".
PUBLIC_ROOTS = {"", "about", "products", "repair-guide", "gallery", "catalogue", "catalogue.pdf", "contact",
                "distributor", "static", "robots.txt", "sitemap.xml", "api", "billing", "favicon.ico"}
_ADMIN = {"path": None}


def admin_path():
    if _ADMIN["path"] is None:
        with db.connect() as c:
            r = c.execute("SELECT value FROM settings WHERE key='admin_path'").fetchone()
            if not r:  # first run: pick a random address
                path = "/office-" + secrets.token_hex(4)
                c.execute("INSERT INTO settings (key, value) VALUES ('admin_path', ?)", (path,))
            _ADMIN["path"] = r["value"] if r else path
    return _ADMIN["path"]


def admin_url(sub=""):
    return admin_path() + sub


class AdminPrefix:
    """Maps <secret path>/... to /billing/... and <secret path>/api/... to /api/...; hides the plain paths."""

    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        p, base = environ.get("PATH_INFO", ""), admin_path()
        if p == base or p.startswith(base + "/"):
            rest = p[len(base):]
            environ["PATH_INFO"] = rest if rest.startswith("/api/") else "/billing" + rest
        elif p.startswith(("/api/", "/billing/")) or p in ("/api", "/billing"):
            environ["PATH_INFO"] = "/__not-found"
        return self.wsgi_app(environ, start_response)


app.wsgi_app = AdminPrefix(app.wsgi_app)

if os.environ.get("BILLING_PROXY") == "1":
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Session key is created once and kept next to the database (never commit or share this file)
KEY_FILE = os.path.join(db.BASE, "secret.key")
if not os.path.exists(KEY_FILE):
    with open(KEY_FILE, "w") as f:
        f.write(secrets.token_hex(32))
with open(KEY_FILE) as f:
    app.secret_key = f.read().strip()
app.config.update(
    SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax", SESSION_COOKIE_SECURE=HTTPS,
    SESSION_COOKIE_NAME="nt_session", PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=10 * 1024 * 1024,  # largest upload: 10 MB
)
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse "decompression bomb" images

app.register_blueprint(site_pages.bp)

# ---------------------------------------------------------------- security headers
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
       "frame-src 'self' https://www.google.com https://maps.google.com; frame-ancestors 'self'; "
       "form-action 'self'; base-uri 'self'; object-src 'none'")


@app.after_request
def security_headers(resp):
    h = resp.headers
    h["Content-Security-Policy"] = CSP
    h["X-Content-Type-Options"] = "nosniff"
    h["X-Frame-Options"] = "SAMEORIGIN"
    h["Referrer-Policy"] = "strict-origin-when-cross-origin"
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    h["Cross-Origin-Opener-Policy"] = "same-origin"
    if HTTPS:
        h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if request.path.startswith(("/billing", "/api/")):
        h["Cache-Control"] = "no-store"
        h["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        h["Referrer-Policy"] = "no-referrer"  # never pass the secret address to other sites
    h.pop("Server", None)
    return resp


@app.errorhandler(413)
def too_large(e):
    return jsonify(error="File is too large (max 10 MB)"), 413


@app.errorhandler(500)
def server_error(e):
    if request.path.startswith("/api/"):
        return jsonify(error="Something went wrong. Please try again."), 500
    return "Something went wrong. Please try again.", 500


# ---------------------------------------------------------------- login
def get_setting(key):
    with db.connect() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return r["value"] if r else None


def set_setting(key, value):
    with db.connect() as c:
        c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (key, value))


def set_password(pw):
    """Saves a new password and signs out every existing session."""
    set_setting("admin_password_hash", generate_password_hash(pw))
    set_setting("auth_version", secrets.token_hex(8))


def start_session():
    session.clear()  # new session on login (no session fixation)
    session["admin"] = True
    session["ver"] = get_setting("auth_version")
    session.permanent = True


# The first password needs a one-time code that is printed only in the app's console window,
# so nobody on the internet can claim a freshly hosted site.
SETUP_CODE = secrets.token_hex(4).upper()


@app.before_request
def guard():
    p = request.path
    # Requests that change data must come from this site's own pages (blocks cross-site request forgery)
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        source = request.headers.get("Origin") or request.headers.get("Referer")
        if source and urlparse(source).netloc != request.host:
            return jsonify(error="Request blocked"), 403
    # The public website is open to all; billing pages and the billing API need the admin password
    if not p.startswith(("/api/", "/billing")) or p in ("/billing/login", "/billing/setup"):
        return None
    if session.get("admin") and session.get("ver") == get_setting("auth_version"):
        return None
    session.clear()
    if p.startswith("/api/"):
        return jsonify(error="Please log in again"), 401
    return redirect(admin_url("/setup") if not get_setting("admin_password_hash") else admin_url("/login"))


@app.route("/billing/setup", methods=["GET", "POST"])
def billing_setup():
    if get_setting("admin_password_hash"):
        return redirect(admin_url("/login"))
    error = None
    if request.method == "POST":
        pw, pw2 = request.form.get("password", ""), request.form.get("password2", "")
        if not secrets.compare_digest(request.form.get("code", "").strip().upper(), SETUP_CODE):
            error = "Wrong setup code. Use the code shown in the app's console window."
            time.sleep(1)
        elif len(pw) < 10:
            error = "Use at least 10 characters."
        elif pw != pw2:
            error = "The two passwords do not match."
        else:
            set_password(pw)
            start_session()
            return redirect(admin_url())
    return render_template("login.html", mode="setup", error=error)


FAILED = {}  # ip -> times of recent wrong passwords
LOCK_AFTER, LOCK_SECONDS = 5, 15 * 60


@app.route("/billing/login", methods=["GET", "POST"])
def billing_login():
    if not get_setting("admin_password_hash"):
        return redirect(admin_url("/setup"))
    error = None
    if request.method == "POST":
        ip, now = request.remote_addr, time.time()
        FAILED[ip] = [t for t in FAILED.get(ip, []) if now - t < LOCK_SECONDS]
        if len(FAILED[ip]) >= LOCK_AFTER:
            error = "Too many wrong attempts. Try again in 15 minutes."
        elif check_password_hash(get_setting("admin_password_hash"), request.form.get("password", "")):
            FAILED.pop(ip, None)
            start_session()
            return redirect(admin_url())
        else:
            FAILED[ip].append(now)
            time.sleep(1)  # slows down password guessing
            left = LOCK_AFTER - len(FAILED[ip])
            error = (f"Wrong password. {left} attempt{'s' if left != 1 else ''} left." if left
                     else "Too many wrong attempts. Try again in 15 minutes.")
    return render_template("login.html", mode="login", error=error)


@app.get("/billing/logout")
def billing_logout():
    session.clear()
    return redirect(admin_url("/login"))


@app.put("/api/password")
def change_password():
    d = request.json
    if not check_password_hash(get_setting("admin_password_hash"), d.get("current", "")):
        time.sleep(1)
        return fail("Current password is wrong")
    if len(d.get("new", "")) < 10:
        return fail("Use at least 10 characters")
    set_password(d["new"])
    start_session()  # keep this device signed in, sign out all others
    return jsonify(ok=True)


COMPANY_FIELDS = ["name", "address", "gstin", "state", "state_code", "email", "phone", "pan", "bank_holder",
                  "bank_name", "bank_account", "bank_ifsc", "bank_branch", "upi_id", "invoice_prefix"]
CLIENT_FIELDS = ["name", "address", "gstin", "state", "state_code", "phone", "email"]
PRODUCT_FIELDS = ["code", "name", "category", "hsn", "unit", "price_internal", "price_external", "price_other",
                  "units_per_box", "mrp", "size", "rating"]
AUTO_NUMBERED = ("pi_excl", "pi_incl", "other")


def fail(msg, code=400):
    return jsonify(error=msg), code


def clean(data, fields):
    out = {}
    for f in fields:
        v = data.get(f)
        out[f] = v.strip() if isinstance(v, str) else v
    return out


@app.context_processor
def admin_context():
    return {"admin_base": admin_path()}


@app.route("/billing")
def billing_app():
    return render_template("billing.html")


@app.put("/api/admin-path")
def change_admin_path():
    path = "/" + str(request.json.get("path", "")).strip().strip("/")
    if not re.fullmatch(r"/[A-Za-z0-9][A-Za-z0-9_-]{5,39}", path):
        return fail("Use 6 to 40 letters, numbers, - or _ (no spaces or slashes)")
    if path[1:].lower() in PUBLIC_ROOTS or path.lower().startswith(("/api", "/billing", "/static")):
        return fail("That address is used by the website. Choose another one.")
    set_setting("admin_path", path)
    _ADMIN["path"] = path
    return jsonify(path=path)


@app.get("/api/bootstrap")
def bootstrap():
    with db.connect() as c:
        return jsonify(
            companies=db.rows(c.execute("SELECT * FROM companies ORDER BY id")),
            settings={r["key"]: r["value"] for r in c.execute("SELECT * FROM settings WHERE key<>'admin_password_hash'")},
            new_enquiries=c.execute("SELECT COUNT(*) FROM enquiries WHERE status='new'").fetchone()[0],
            admin_path=admin_path(),
            bill_types=billing.BILL_TYPES, price_lists=billing.PRICE_LISTS,
            states=[{"code": k, "name": v} for k, v in billing.STATES], today=date.today().isoformat())


# ---------- companies (From entities) ----------
@app.post("/api/companies")
def company_create():
    d = clean(request.json, COMPANY_FIELDS)
    if not d["name"]:
        return fail("Company name is required")
    with db.connect() as c:
        cur = c.execute(f"INSERT INTO companies (kind,{','.join(d)}) VALUES ('other',{','.join('?' * len(d))})",
                        list(d.values()))
        return jsonify(db.row(c.execute("SELECT * FROM companies WHERE id=?", (cur.lastrowid,)).fetchone()))


@app.put("/api/companies/<int:cid>")
def company_update(cid):
    d = clean(request.json, COMPANY_FIELDS)
    if not d["name"]:
        return fail("Company name is required")
    with db.connect() as c:
        c.execute(f"UPDATE companies SET {','.join(f'{k}=?' for k in d)} WHERE id=?", [*d.values(), cid])
        return jsonify(db.row(c.execute("SELECT * FROM companies WHERE id=?", (cid,)).fetchone()))


@app.delete("/api/companies/<int:cid>")
def company_delete(cid):
    with db.connect() as c:
        if c.execute("SELECT kind FROM companies WHERE id=?", (cid,)).fetchone()["kind"] != "other":
            return fail("Omkar Industries and Shree Siddhivinayak Industries cannot be deleted")
        c.execute("DELETE FROM companies WHERE id=?", (cid,))
    return jsonify(ok=True)


@app.post("/api/companies/<int:cid>/logo")
def company_logo(cid):
    f = request.files.get("logo")
    if not f:
        return fail("No file uploaded")
    img = Image.open(f.stream).convert("RGBA")
    # trim white / transparent margins so the logo prints at a useful size
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bbox = Image.alpha_composite(bg, img).convert("L").point(lambda p: 255 if p < 245 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    img.thumbnail((600, 600))
    name = f"company_{cid}.png"
    img.save(os.path.join(pdfgen.LOGO_DIR, name))
    with db.connect() as c:
        c.execute("UPDATE companies SET logo=? WHERE id=?", (name, cid))
    return jsonify(logo=name)


# ---------- clients ----------
@app.get("/api/clients")
def clients():
    with db.connect() as c:
        return jsonify(db.rows(c.execute("SELECT * FROM clients ORDER BY name")))


@app.put("/api/clients/<int:cid>")
def client_update(cid):
    d = clean(request.json, CLIENT_FIELDS)
    with db.connect() as c:
        c.execute(f"UPDATE clients SET {','.join(f'{k}=?' for k in d)} WHERE id=?", [*d.values(), cid])
    return jsonify(ok=True)


@app.delete("/api/clients/<int:cid>")
def client_delete(cid):
    with db.connect() as c:
        c.execute("DELETE FROM clients WHERE id=?", (cid,))
    return jsonify(ok=True)


def upsert_client(c, buyer):
    d = clean(buyer, CLIENT_FIELDS)
    if not d["name"]:
        return
    if c.execute("SELECT 1 FROM clients WHERE name=?", (d["name"],)).fetchone():
        # only overwrite fields that were filled in, so a bill with a partial address never wipes saved details
        d = {k: v for k, v in d.items() if v}
        c.execute(f"UPDATE clients SET {','.join(f'{k}=?' for k in d)} WHERE name=?", [*d.values(), d["name"]])
    else:
        c.execute(f"INSERT INTO clients ({','.join(d)}) VALUES ({','.join('?' * len(d))})", list(d.values()))


# ---------- products ----------
@app.get("/api/products")
def products():
    with db.connect() as c:
        return jsonify(db.rows(c.execute("SELECT * FROM products ORDER BY id")))


@app.post("/api/products")
def product_create():
    d = clean(request.json, PRODUCT_FIELDS)
    if not d["name"]:
        return fail("Product name is required")
    d["hsn"] = d["hsn"] or "40169310"
    d["unit"] = d["unit"] or "unit"
    with db.connect() as c:
        if c.execute("SELECT 1 FROM products WHERE name=?", (d["name"],)).fetchone():
            return fail("A product with this name already exists")
        cur = c.execute(f"INSERT INTO products ({','.join(d)}) VALUES ({','.join('?' * len(d))})", list(d.values()))
        return jsonify(db.row(c.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone()))


@app.put("/api/products/<int:pid>")
def product_update(pid):
    d = clean(request.json, PRODUCT_FIELDS)
    if not d["name"]:
        return fail("Product name is required")
    with db.connect() as c:
        if c.execute("SELECT 1 FROM products WHERE name=? AND id<>?", (d["name"], pid)).fetchone():
            return fail("A product with this name already exists")
        c.execute(f"UPDATE products SET {','.join(f'{k}=?' for k in d)} WHERE id=?", [*d.values(), pid])
    return jsonify(ok=True)


@app.delete("/api/products/<int:pid>")
def product_delete(pid):
    with db.connect() as c:
        c.execute("DELETE FROM products WHERE id=?", (pid,))
    return jsonify(ok=True)


# ---------- website enquiries ----------
@app.get("/api/enquiries")
def enquiries():
    with db.connect() as c:
        return jsonify(db.rows(c.execute("SELECT * FROM enquiries ORDER BY id DESC")))


@app.put("/api/enquiries/<int:eid>")
def enquiry_update(eid):
    status = request.json.get("status")
    if status not in ("new", "contacted", "closed"):
        return fail("Unknown status")
    with db.connect() as c:
        c.execute("UPDATE enquiries SET status=? WHERE id=?", (status, eid))
    return jsonify(ok=True)


@app.delete("/api/enquiries/<int:eid>")
def enquiry_delete(eid):
    with db.connect() as c:
        c.execute("DELETE FROM enquiries WHERE id=?", (eid,))
    return jsonify(ok=True)


# ---------- settings ----------
@app.put("/api/settings")
def settings_update():
    with db.connect() as c:
        for k, v in request.json.items():
            if k == "admin_password_hash":
                continue
            c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", (k, str(v)))
    return jsonify(ok=True)


# ---------- invoices ----------
def next_auto_number(c, bill_type):
    nums = [int(r["invoice_no"]) for r in c.execute("SELECT invoice_no FROM invoices WHERE bill_type=?", (bill_type,))
            if r["invoice_no"].isdigit()]
    return str(max(nums, default=0) + 1)


def company_prefix(company, inv_date):
    return f"{company['invoice_prefix'] or company['name'].split()[0].upper()}/{billing.financial_year(inv_date)}/"


@app.get("/api/next-number")
def next_number():
    bill_type, inv_date = request.args["bill_type"], request.args.get("date") or date.today().isoformat()
    with db.connect() as c:
        if bill_type in AUTO_NUMBERED:
            return jsonify(number=next_auto_number(c, bill_type))
        company = c.execute("SELECT * FROM companies WHERE kind=?", (bill_type,)).fetchone()
        prefix = company_prefix(company, inv_date)
        last = c.execute("SELECT invoice_no FROM invoices WHERE bill_type=? AND invoice_no LIKE ? ORDER BY id DESC LIMIT 1",
                         (bill_type, prefix + "%")).fetchone()
        return jsonify(prefix=prefix, last=last["invoice_no"] if last else None)


def eway_threshold(c):
    return billing.num(c.execute("SELECT value FROM settings WHERE key='eway_threshold'").fetchone()["value"], 50000)


def eway_status(inv, threshold):
    required = billing.eway_required(inv["bill_type"], inv["grand_total"], threshold)
    return {"eway_required": required, "eway_pending": required and not inv["details"].get("eway_bill_no")}


def clean_eway(details):
    """Normalise the e-Way Bill number; returns an error message if it is not 12 digits."""
    no = re.sub(r"\s+", "", str(details.get("eway_bill_no") or ""))
    details["eway_bill_no"] = no
    if no and not re.fullmatch(r"\d{12}", no):
        return "e-Way Bill number must be 12 digits"
    return None


@app.get("/api/invoices")
def invoices():
    sql = ("SELECT id, bill_type, invoice_no, date, buyer, seller, details, subtotal, tax_total, grand_total "
           "FROM invoices WHERE bill_type=? ORDER BY date DESC, id DESC")
    with db.connect() as c:
        threshold = eway_threshold(c)
        out = []
        for r in c.execute(sql, (request.args["bill_type"],)):
            d = dict(r)
            d["client"] = json.loads(d.pop("buyer")).get("name", "")
            d["from"] = json.loads(d.pop("seller")).get("name", "")
            d["details"] = json.loads(d["details"] or "{}")
            d.update(eway_status(d, threshold))
            del d["details"]
            out.append(d)
        counts = {r["bill_type"]: r["n"] for r in c.execute("SELECT bill_type, COUNT(*) n FROM invoices GROUP BY bill_type")}
        return jsonify(invoices=out, counts=counts)


def load_invoice(c, iid):
    r = c.execute("SELECT * FROM invoices WHERE id=?", (iid,)).fetchone()
    if not r:
        abort(404)
    return db.invoice_dict(r)


@app.get("/api/invoices/<int:iid>")
def invoice_get(iid):
    with db.connect() as c:
        inv = load_invoice(c, iid)
        inv.update(eway_status(inv, eway_threshold(c)), eway_threshold=eway_threshold(c),
                   has_ewb_pdf=os.path.exists(ewaybill.pdf_path(iid)))
        return jsonify(inv)


@app.get("/api/invoices/<int:iid>/ewb-json")
def invoice_ewb_json(iid):
    """Bulk-upload JSON for the e-Way Bill portal, plus anything that must be fixed first."""
    with db.connect() as c:
        inv = billing.calculate(load_invoice(c, iid))
    data, problems = ewaybill.build(inv)
    fname = re.sub(r"[^A-Za-z0-9_-]+", "_", f"EWB_{inv['invoice_no']}") + ".json"
    return jsonify(data=data, problems=problems, filename=fname)


@app.route("/api/invoices/<int:iid>/ewb-pdf", methods=["GET", "POST", "DELETE"])
def invoice_ewb_pdf(iid):
    """The e-Way Bill PDF downloaded from the portal, kept with the invoice."""
    path = ewaybill.pdf_path(iid)
    if request.method == "GET":
        if not os.path.exists(path):
            abort(404)
        return send_file(path, mimetype="application/pdf", download_name=f"e-Way-Bill-{iid}.pdf",
                         as_attachment=bool(request.args.get("download")))
    if request.method == "DELETE":
        if os.path.exists(path):
            os.remove(path)
        return jsonify(ok=True)

    f = request.files.get("file")
    if not f:
        return fail("Choose the e-Way Bill PDF")
    head = f.stream.read(5)
    f.stream.seek(0)
    if head != b"%PDF-":
        return fail("That file is not a PDF")
    os.makedirs(ewaybill.UPLOAD_DIR, exist_ok=True)
    f.save(path)
    found = ewaybill.read_portal_pdf(path)
    with db.connect() as c:
        inv = load_invoice(c, iid)
        if found.get("eway_bill_no"):  # fill the number and date from the portal's PDF
            inv["details"].update(found)
            c.execute("UPDATE invoices SET details=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                      (json.dumps(inv["details"]), iid))
    return jsonify(ok=True, found=found)


@app.put("/api/invoices/<int:iid>/eway")
def invoice_eway(iid):
    """Add the e-Way Bill number to a saved bill (it is usually generated after the invoice)."""
    data = {"eway_bill_no": request.json.get("eway_bill_no"), "eway_bill_date": request.json.get("eway_bill_date") or ""}
    err = clean_eway(data)
    if err or not data["eway_bill_no"]:
        return fail(err or "Enter the e-Way Bill number")
    with db.connect() as c:
        inv = load_invoice(c, iid)
        inv["details"].update(data)
        c.execute("UPDATE invoices SET details=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", (json.dumps(inv["details"]), iid))
    return jsonify(ok=True)


def save_invoice(data, iid=None):
    bill_type = data.get("bill_type")
    if bill_type not in billing.BILL_TYPES:
        return fail("Select a bill format")
    if data.get("price_list") not in billing.PRICE_LISTS:
        return fail("Select a price list")
    inv_date = data.get("date") or date.today().isoformat()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", inv_date):
        return fail("Invalid date")
    buyer = clean(data.get("buyer") or {}, CLIENT_FIELDS)
    if not buyer["name"]:
        return fail("Enter the client (Bill To) name")
    details = data.get("details") or {}
    err = clean_eway(details)
    if err:
        return fail(err)

    with db.connect() as c:
        # From (seller)
        if bill_type in ("omkar", "ssi"):
            company = db.row(c.execute("SELECT * FROM companies WHERE kind=?", (bill_type,)).fetchone())
        elif data.get("company_id") == "new":
            nc = clean(data.get("new_company") or {}, COMPANY_FIELDS)
            if not nc["name"]:
                return fail("Enter the From company name")
            cur = c.execute(f"INSERT INTO companies (kind,{','.join(nc)}) VALUES ('other',{','.join('?' * len(nc))})",
                            list(nc.values()))
            company = db.row(c.execute("SELECT * FROM companies WHERE id=?", (cur.lastrowid,)).fetchone())
        else:
            company = db.row(c.execute("SELECT * FROM companies WHERE id=?", (data.get("company_id"),)).fetchone())
            if not company:
                return fail("Select the From company")

        # Invoice number
        if bill_type in ("omkar", "ssi"):
            suffix = str(data.get("invoice_suffix") or "").strip()
            if not suffix:
                return fail("Enter the invoice number (the part after the prefix)")
            invoice_no = company_prefix(company, inv_date) + suffix
        else:
            invoice_no = str(data.get("invoice_no") or "").strip() or next_auto_number(c, bill_type)
        dup = c.execute("SELECT 1 FROM invoices WHERE bill_type=? AND invoice_no=? AND id<>?",
                        (bill_type, invoice_no, iid or 0)).fetchone()
        if dup:
            return fail(f"Invoice number {invoice_no} already exists for this bill type", 409)

        inv = dict(bill_type=bill_type, price_list=data["price_list"], invoice_no=invoice_no, date=inv_date,
                   company_id=company["id"], seller=company, buyer=buyer,
                   tax_mode=data.get("tax_mode") if data.get("tax_mode") in ("igst", "cgst_sgst") else "none",
                   igst_rate=billing.num(data.get("igst_rate")), cgst_rate=billing.num(data.get("cgst_rate")),
                   sgst_rate=billing.num(data.get("sgst_rate")), qty_pct=data.get("qty_pct"),
                   items=data.get("items") or [], details=details)
        billing.calculate(inv)
        if not inv["items"]:
            return fail("Add at least one product")

        upsert_client(c, buyer)
        cols = ["bill_type", "price_list", "invoice_no", "date", "company_id", "seller", "buyer", "tax_mode",
                "igst_rate", "cgst_rate", "sgst_rate", "qty_pct", "items", "details", "subtotal", "tax_total",
                "round_off", "grand_total"]
        vals = [json.dumps(inv[k]) if k in ("seller", "buyer", "items", "details") else inv[k] for k in cols]
        if iid:
            c.execute(f"UPDATE invoices SET {','.join(f'{k}=?' for k in cols)}, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                      [*vals, iid])
        else:
            iid = c.execute(f"INSERT INTO invoices ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals).lastrowid
        return jsonify(id=iid, invoice_no=invoice_no, **eway_status(inv, eway_threshold(c)))


@app.post("/api/invoices")
def invoice_create():
    return save_invoice(request.json)


@app.put("/api/invoices/<int:iid>")
def invoice_update(iid):
    return save_invoice(request.json, iid)


@app.delete("/api/invoices/<int:iid>")
def invoice_delete(iid):
    with db.connect() as c:
        c.execute("DELETE FROM invoices WHERE id=?", (iid,))
    if os.path.exists(ewaybill.pdf_path(iid)):
        os.remove(ewaybill.pdf_path(iid))
    return jsonify(ok=True)


@app.get("/api/invoices/<int:iid>/pdf")
def invoice_pdf(iid):
    with db.connect() as c:
        inv = load_invoice(c, iid)
        terms = c.execute("SELECT value FROM settings WHERE key='terms'").fetchone()["value"]
    billing.calculate(inv)
    y, m, d = inv["date"].split("-")
    inv["date_display"] = f"{d}-{m}-{y}"
    pdf = pdfgen.render(inv, terms, copies=request.args.get("copies", "original"))
    fname = re.sub(r"[^A-Za-z0-9_-]+", "_", f"{inv['invoice_no']}_{inv['buyer'].get('name', '')}").strip("_") + ".pdf"
    disp = "attachment" if request.args.get("download") else "inline"
    return Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": f'{disp}; filename="{fname}"'})


if __name__ == "__main__":
    if sys.argv[1:] == ["set-password"]:  # python app.py set-password  (works on the hosting server too)
        import getpass
        pw = getpass.getpass("New billing password (min. 10 characters): ")
        if len(pw) < 10 or pw != getpass.getpass("Type it again: "):
            sys.exit("Not changed: passwords must match and be at least 10 characters.")
        set_password(pw)
        sys.exit("Password saved. All devices have been logged out.")
    if sys.argv[1:] == ["show-billing-address"]:  # in case the secret address is forgotten
        sys.exit(f"Billing address: {admin_path()}")

    host = os.environ.get("BILLING_HOST", "127.0.0.1")
    port = int(os.environ.get("BILLING_PORT", "5000"))
    print(f"\n  NEU-TECH website:  http://localhost:{port}")
    print(f"  Billing (secret, do not share):  http://localhost:{port}{admin_path()}")
    if not get_setting("admin_password_hash"):
        print(f"  First-time billing setup code:  {SETUP_CODE}")
    if os.environ.get("BILLING_OPEN") == "1":  # set by run.bat: open billing in the browser
        import threading
        import webbrowser
        threading.Timer(1.5, webbrowser.open, [f"http://localhost:{port}{admin_path()}"]).start()
    if host == "0.0.0.0":
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))  # no data is sent; this only picks the Wi-Fi/LAN address
            print(f"  On your phone (same Wi-Fi):  http://{s.getsockname()[0]}:{port}")
        except OSError:
            pass
        finally:
            s.close()
    print()
    try:
        from waitress import serve  # production-grade server
        serve(app, host=host, port=port, threads=8, ident="")
    except ImportError:
        app.run(host=host, port=port, debug=False)
