"""Builds the Cloudflare Pages site into dist/.

  python build.py

- Renders every public page from the Jinja templates into static HTML.
- Generates the catalogue PDF, sitemap.xml, robots.txt, _headers and _routes.json.
- Exports shared data (states, bill types, starting companies and products) to src/generated/data.json
  for the billing code that runs as Cloudflare Pages Functions.

Environment: SITE_URL (e.g. https://durane.cipherverse.workers.dev or your own domain) is used for canonical links and
the sitemap.
"""
import json
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "gst_billing")
DIST = os.path.join(ROOT, "dist")
sys.path.insert(0, APP_DIR)

from flask import Flask  # noqa: E402

import billing  # noqa: E402
import catalog  # noqa: E402
import catalogue_pdf  # noqa: E402
import db  # noqa: E402
import site_pages  # noqa: E402

SITE_URL = (os.environ.get("SITE_URL") or os.environ.get("CF_PAGES_URL") or "https://durane.cipherverse.workers.dev").rstrip("/")


def write(rel, content, mode="w"):
    path = os.path.join(DIST, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode, **({} if "b" in mode else {"encoding": "utf8"})) as f:
        f.write(content)


def export_data():
    """Shared data for the billing Functions (single source of truth stays in Python)."""
    sizes = {}
    for rows in catalog.SPECS.values():
        for r in rows:
            m = re.fullmatch(r"Neu-Plug (\d+)", r["name"])
            sizes[f"PLUG PATCH {m.group(1)}MM" if m else r["name"].replace("-", " ")] = (r["size"], r["rating"])
    products = []
    for code, name, category, per_box, mrp, internal, external in db.PRODUCTS:
        size, rating = sizes.get(name, ("", ""))
        products.append(dict(code=code, name=name, category=category, units_per_box=per_box, mrp=mrp,
                             price_internal=internal, price_external=external, size=size, rating=rating))
    data = dict(bill_types=billing.BILL_TYPES, price_lists=billing.PRICE_LISTS,
                states=[{"code": k, "name": v} for k, v in billing.STATES],
                companies=db.COMPANIES, products=products, settings=db.DEFAULT_SETTINGS)
    out = os.path.join(ROOT, "src", "generated")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "data.json"), "w", encoding="utf8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


PAGES = ["/", "/about", "/products", "/repair-guide", "/gallery", "/catalogue", "/contact", "/distributor"] + \
        [f"/products/{f['slug']}" for f in catalog.FAMILIES]


def render_site():
    app = Flask(__name__, template_folder=os.path.join(APP_DIR, "templates"))
    app.register_blueprint(site_pages.bp)

    @app.context_processor
    def site_url():
        return {"site_url": SITE_URL}

    client = app.test_client()
    for page in PAGES:
        r = client.get(page)
        assert r.status_code == 200, (page, r.status_code)
        write("index.html" if page == "/" else page.strip("/") + ".html", r.get_data(as_text=True))
    r = client.get("/__missing__")
    write("404.html", r.get_data(as_text=True))


def copy_static():
    shutil.copytree(os.path.join(APP_DIR, "static"), os.path.join(DIST, "static"),
                    ignore=shutil.ignore_patterns("_*.html"))
    vendor = os.path.join(DIST, "static", "vendor", "pdfjs")
    os.makedirs(vendor, exist_ok=True)
    src = os.path.join(ROOT, "node_modules", "pdfjs-dist", "build")
    for name in ("pdf.min.mjs", "pdf.worker.min.mjs"):
        if os.path.exists(os.path.join(src, name)):
            shutil.copy(os.path.join(src, name), vendor)
        else:
            print(f"warning: {name} missing - run npm install (e-Way Bill PDF reading will be unavailable)")


CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; "
       "frame-src 'self' https://www.google.com https://maps.google.com; frame-ancestors 'self'; "
       "form-action 'self'; base-uri 'self'; object-src 'none'")


def write_meta():
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n")
    urls = "".join(f"<url><loc>{SITE_URL}{'' if p == '/' else p}</loc></url>" for p in PAGES + ["/catalogue.pdf"])
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>'
                         f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
    write("_headers", "/*\n"
          f"  Content-Security-Policy: {CSP}\n"
          "  X-Content-Type-Options: nosniff\n"
          "  X-Frame-Options: SAMEORIGIN\n"
          "  Referrer-Policy: strict-origin-when-cross-origin\n"
          "  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()\n"
          "  Cross-Origin-Opener-Policy: same-origin\n"
          "  Strict-Transport-Security: max-age=31536000; includeSubDomains\n"
          "/static/*\n  Cache-Control: public, max-age=604800\n")
    # Public pages are plain static files; only the secret billing address and the form endpoints run code
    exclude = ["/", "/static/*", "/catalogue.pdf", "/robots.txt", "/sitemap.xml", "/404.html", "/favicon.ico"]
    exclude += [p for p in PAGES if p != "/"] + [p + ".html" for p in PAGES if p != "/"]
    write("_routes.json", json.dumps({"version": 1, "include": ["/*"], "exclude": exclude}, indent=1))


def main():
    if os.path.exists(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)
    export_data()
    render_site()
    copy_static()
    write("catalogue.pdf", catalogue_pdf.build(), "wb")
    write_meta()
    print(f"Built {len(PAGES)} pages into dist/ for {SITE_URL}")


if __name__ == "__main__":
    main()
