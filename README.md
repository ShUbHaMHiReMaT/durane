# NEU-TECH Website & GST Billing

Website and private billing system for **Omkar Industries**, Belagavi, maker of NEU-TECH tyre & tube repair patches.
Runs entirely on **Cloudflare Workers** (live at https://durane.cipherverse.workers.dev):

| Part | How it runs on Cloudflare |
|---|---|
| Public website (home, products, size charts, repair guide, gallery, catalogue, contact, distributor) | Static files built by `build.py`, served directly |
| Catalogue PDF | Generated during the build (`/catalogue.pdf`) |
| Quotes, enquiries, distributor applications | WhatsApp and phone buttons on every page and next to every size (no forms) |
| Billing (GST invoices, PDFs, e-Way Bill, clients, products, backups) | Worker code + D1, at a **secret address** with a password |

---

## Deploy on Cloudflare Workers

The project is configured in `wrangler.jsonc` (Worker name `durane`, static files from `dist/`, D1 database bound as `DB`).

### 1. Create the database (once)

Cloudflare dashboard → **Storage & Databases → D1 → Create database** → name it `neutech`.
Copy its **Database ID** and paste it into `wrangler.jsonc` in place of `PASTE-YOUR-D1-DATABASE-ID-HERE`.
(The ID is not a secret; it only works with your Cloudflare login.)

### 2. Build settings

Worker `durane` → **Settings → Build**:

| Setting | Value |
|---|---|
| **Build command** | `pip install -r requirements-build.txt && python build.py` |
| **Deploy command** | `npx wrangler deploy` |
| Root directory | *(leave empty)* |

**Build variables** (Settings → Build → Variables and secrets):

| Name | Value |
|---|---|
| `PYTHON_VERSION` | `3.11` |
| `SITE_URL` | `https://durane.cipherverse.workers.dev` (or your own domain later) |

### 3. Open billing and set the password

Billing is at **https://durane.cipherverse.workers.dev/billing** (password protected).

The first time, it asks for a **setup code**. Get it from Cloudflare:
**Storage & Databases → D1 → neutech → Console**, run

```sql
SELECT value FROM settings WHERE key='setup_code'
```

Enter that code, choose a password of at least 10 characters, and bookmark the billing address.

### 4. Optional: a secret billing address

To hide billing at an unguessable address instead of `/billing`, change it in billing → **Settings → Secret Billing Address**
(or add a Worker secret named `ADMIN_PATH`, e.g. `npx wrangler secret put ADMIN_PATH`, then type `/office-7qk2mz9x`).
A Worker secret `SETUP_CODE` can also replace the generated setup code.

### 5. Move your existing data (once)

To copy bills, clients and products from the old local version (`gst_billing/billing.db`):

```bash
python migrate_to_d1.py
npx wrangler login
npx wrangler d1 execute neutech --remote --file=migration.sql
```

Then delete `migration.sql` (it contains your business data). Uploaded logos are not copied: upload them again in **Settings**.

### 6. Your own domain (optional)

Worker `durane` → **Settings → Domains & Routes → Add → Custom domain**. Update `SITE_URL` and redeploy.

---

## Keeping your data safe

Everything is stored in the D1 database, which is **separate from the website**: deleting or redeploying the Worker does not delete it.

1. **Download a full backup** in billing → **Settings → Backup & Restore**. It contains all bills, clients, products, settings, the activity log, e-Way Bill PDFs and logos. Keep copies on your computer and Google Drive. Billing reminds you if you haven't downloaded one in 7 days.
2. **Restore from backup** puts everything back, into the same site or a brand-new Cloudflare account.
3. **Activity log** (Settings → Activity) records every change. Deleted bills, clients and products can be brought back with **Restore**.
4. **D1 Time Travel**: Cloudflare can rewind the database to any minute in the last 30 days:
   ```bash
   npx wrangler d1 time-travel info neutech
   npx wrangler d1 time-travel restore neutech --timestamp=2026-10-25T10:00:00+05:30
   ```
5. **Full database export** (an SQL file of everything):
   ```bash
   npx wrangler d1 export neutech --remote --output=neutech-export.sql
   ```

Never upload backups or exports anywhere public: they contain all your business data.

---

## Security

- Billing is at `/billing` unless you set a secret address (Settings → Secret Billing Address); then `/billing`, `/api` and other guesses show the normal "page not found". The billing address is never in `robots.txt`, the sitemap or any link.
- Password login (stored as a salted PBKDF2 hash), 12-hour signed sessions, lockout for 15 minutes after 5 wrong passwords; changing the password signs out every device.
- Requests from other websites are blocked; strict Content-Security-Policy and other security headers on every page; billing is never cached or indexed.

**Forgot something?**

```bash
# show the billing address (empty = /billing)
npx wrangler d1 execute neutech --remote --command "SELECT value FROM settings WHERE key='admin_path'"
# show the setup code
npx wrangler d1 execute neutech --remote --command "SELECT value FROM settings WHERE key='setup_code'"
# reset the password (then open the billing address and use the setup code again)
npx wrangler d1 execute neutech --remote --command "DELETE FROM settings WHERE key='admin_password_hash'"
```

**Keep this repository private** on GitHub: the source contains your price lists.

---

## Run it on your computer (optional preview)

```bash
npm install
pip install -r requirements-build.txt
npm run build
```

Create a file `.dev.vars` (never commit it):

```
ADMIN_PATH=/office-local123
SETUP_CODE=choose-any-code
```

Then `npm run dev` and open http://localhost:8787.

---

## Project layout

```
build.py              builds dist/ (static pages, catalogue PDF, headers, routes) and src/generated/data.json
wrangler.jsonc        Cloudflare Workers configuration (name, static files, D1 binding)
src/worker.js         Worker entry point
src/                  server code: billing API, login, invoice PDF, e-Way Bill, backups
functions/            entry point if the project is ever deployed with Cloudflare Pages instead
gst_billing/
  catalog.py          website content: product families, size charts, photos, company details
  templates/site/     website page templates
  static/             styles, scripts (site.js website, app.js billing), logos and product photos
  billing.py, db.py   GST rules, states, starting products and companies (shared with src/ through the build)
  app.py              old local Python server (not needed on Cloudflare)
migrate_to_d1.py      copies data from the old local database to D1
```

To change website text, size charts or photos, edit `gst_billing/catalog.py` (photos go in
`gst_billing/static/catalog/`) and push. Cloudflare rebuilds the site automatically.
Billing prices are edited inside billing on the **Products** page.
