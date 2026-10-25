"""Public website for NEU-TECH / Omkar Industries."""
import os
from datetime import date
from urllib.parse import quote

from flask import Blueprint, Response, abort, render_template, request

import catalog

bp = Blueprint("site", __name__)


def wa(text=""):
    """WhatsApp chat link to the company number, optionally with a ready-made message."""
    url = f"https://wa.me/{catalog.COMPANY['whatsapp']}"
    return f"{url}?text={quote(text)}" if text else url


@bp.app_context_processor
def site_context():
    # SITE_URL is set when building for Cloudflare; locally the request's own address is used
    site_url = (os.environ.get("SITE_URL") or request.url_root).rstrip("/")
    return dict(company=catalog.COMPANY, families=catalog.FAMILIES, year=date.today().year, caption=catalog.caption,
                logo=catalog.LOGO, specs=catalog.SPECS, cure_types=catalog.CURE_TYPES, site_url=site_url, wa=wa)


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


@bp.get("/contact")
def contact():
    return render_template("site/contact.html")


@bp.get("/distributor")
def distributor():
    return render_template("site/distributor.html")


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
