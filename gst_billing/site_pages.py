"""Public website for NEU-TECH / Omkar Industries."""
import re
import time
from datetime import date

from flask import Blueprint, Response, abort, redirect, render_template, request, url_for

import catalog
import db

bp = Blueprint("site", __name__)

# simple flood protection for the public forms: max 5 enquiries per hour per address
_RECENT = {}


@bp.app_context_processor
def site_context():
    return dict(company=catalog.COMPANY, families=catalog.FAMILIES, year=date.today().year, caption=catalog.caption,
                logo=catalog.LOGO, specs=catalog.SPECS, cure_types=catalog.CURE_TYPES)


@bp.get("/")
def home():
    counts = {slug: len(rows) for slug, rows in catalog.SPECS.items()}
    return render_template("site/home.html", strengths=catalog.STRENGTHS, applications=catalog.APPLICATIONS,
                           counts=counts, total=catalog.total_sizes(), hero=catalog.HERO_IMAGE,
                           gallery=catalog.GALLERY[:6], steps=catalog.REPAIR_STEPS)


@bp.get("/about")
def about():
    return render_template("site/about.html", intro=catalog.INTRO, strengths=catalog.STRENGTHS,
                           applications=catalog.APPLICATIONS)


@bp.get("/products")
def products():
    return render_template("site/products.html")


@bp.get("/products/<slug>")
def product_family(slug):
    fam = catalog.family(slug)
    if not fam:
        abort(404)
    i = catalog.FAMILIES.index(fam)
    return render_template("site/family.html", fam=fam, rows=catalog.SPECS.get(slug, []),
                           prev=catalog.FAMILIES[i - 1] if i else None,
                           next=catalog.FAMILIES[i + 1] if i + 1 < len(catalog.FAMILIES) else None)


@bp.get("/repair-guide")
def repair_guide():
    return render_template("site/guide.html", selector=catalog.SELECTOR, steps=catalog.REPAIR_STEPS, faq=catalog.FAQ)


@bp.get("/gallery")
def gallery():
    images = catalog.GALLERY + [img for f in catalog.FAMILIES for img in f["images"] if img not in catalog.GALLERY]
    return render_template("site/gallery.html", images=images)


def save_enquiry(kind):
    f = request.form
    if f.get("website"):  # hidden field only bots fill in
        return None, None
    data = {k: (f.get(k) or "").strip()[:1000] for k in ("name", "company", "phone", "email", "city", "products", "message")}
    if not data["name"] or len(re.sub(r"\D", "", data["phone"])) < 10:
        return "Please enter your name and a valid phone number.", data
    if data["email"] and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", data["email"]):
        return "Please enter a valid e-mail address, or leave it empty.", data
    ip, now = request.remote_addr, time.time()
    _RECENT[ip] = [t for t in _RECENT.get(ip, []) if now - t < 3600]
    if len(_RECENT[ip]) >= 5:
        return "We have received several messages from you. Please call or WhatsApp us instead.", data
    _RECENT[ip].append(now)
    with db.connect() as c:
        c.execute("INSERT INTO enquiries (kind, name, company, phone, email, city, products, message) VALUES (?,?,?,?,?,?,?,?)",
                  (kind, *data.values()))
    return None, None


@bp.route("/contact", methods=["GET", "POST"])
def contact():
    error, data = None, {}
    if request.method == "POST":
        error, data = save_enquiry("enquiry")
        if not error:
            return redirect(url_for("site.contact", sent=1) + "#enquiry")
    return render_template("site/contact.html", error=error, data=data or {}, sent=request.args.get("sent"),
                           contact_image=catalog.CONTACT_IMAGE)


@bp.route("/distributor", methods=["GET", "POST"])
def distributor():
    error, data = None, {}
    if request.method == "POST":
        error, data = save_enquiry("distributor")
        if not error:
            return redirect(url_for("site.distributor", sent=1) + "#apply")
    return render_template("site/distributor.html", error=error, data=data or {}, sent=request.args.get("sent"))


@bp.get("/catalogue")
def catalogue():
    return render_template("site/catalogue.html", intro=catalog.INTRO, steps=catalog.REPAIR_STEPS)


@bp.get("/catalogue.pdf")
def catalogue_pdf():
    import catalogue_pdf as cp
    pdf = cp.build()
    return Response(pdf, mimetype="application/pdf",
                    headers={"Content-Disposition": 'inline; filename="NEU-TECH-Product-Catalogue.pdf"'})


@bp.get("/robots.txt")
def robots():
    # billing is never named here; it is kept out of search results by its noindex headers instead
    return Response(f"User-agent: *\nAllow: /\nSitemap: {request.url_root}sitemap.xml\n",
                    mimetype="text/plain")


@bp.get("/sitemap.xml")
def sitemap():
    pages = ["", "about", "products", "repair-guide", "gallery", "catalogue", "distributor", "contact"]
    pages += [f"products/{f['slug']}" for f in catalog.FAMILIES]
    urls = "".join(f"<url><loc>{request.url_root}{p}</loc></url>" for p in pages)
    return Response(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>',
                    mimetype="application/xml")


@bp.app_errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return {"error": "Not found"}, 404
    return render_template("site/404.html"), 404
