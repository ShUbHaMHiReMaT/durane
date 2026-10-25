# NEU-TECH Website & GST Billing

Website and private billing system for **Omkar Industries**, Belagavi, maker of NEU-TECH tyre & tube repair patches.
Runs entirely on **Cloudflare Workers** (live at https://durane.cipherverse.workers.dev):

| Part | How it runs on Cloudflare |
|---|---|
| Public website (home, products, size charts, repair guide, gallery, catalogue, contact, distributor) | Static files built by `build.py`, served directly |
| Catalogue PDF | Generated during the build (`/catalogue.pdf`) |
| Enquiry and distributor forms | Worker code (`src/`), saved in the **D1** database |
| Billing (GST invoices, PDFs, e-Way Bill, clients, products, enquiries, backups) | Worker code + D1, at a **secret address** with a password |

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

### 3. Runtime secrets

Worker `durane` → **Settings → Variables and Secrets → Add**, type **Secret**:

| Name | Value |
|---|---|
| `ADMIN_PATH` | your secret billing address, e.g. `/office-7qk2mz9x` (6–40 letters, numbers, `-`) |
| `SETUP_CODE` | a one-time code you choose, used once to create the billing password |

Push to GitHub (or click **Deployments → Retry build**). The database tables are created automatically on the first request.

### 4. Set the billing password

Open `https://durane.cipherverse.workers.dev<ADMIN_PATH>`
(for example `https://durane.cipherverse.workers.dev/office-7qk2mz9x`),
enter the `SETUP_CODE` and choose a password of at least 10 characters. Bookmark the address.

### 5. Move your existing data (once)

To copy bills, clients, products and enquiries from the old local version (`gst_billing/billing.db`):

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

1. **Download a full backup** in billing → **Settings → Backup & Restore**. It contains all bills, clients, products, enquiries, settings, the activity log, e-Way Bill PDFs and logos. Keep copies on your computer and Google Drive. Billing reminds you if you haven't downloaded one in 7 days.
2. **Restore from backup** puts everything back, into the same site or a brand-new Cloudflare account.
3. **Activity log** (Settings → Activity) records every change. Deleted bills, clients, products and enquiries can be brought back with **Restore**.
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

- Billing only exists at the secret `ADMIN_PATH` address. `/billing`, `/api` and other guesses show the normal "page not found". The address is never in `robots.txt`, the sitemap or any link. Change it any time in **Settings → Secret Billing Address**.
- Password login (stored as a salted PBKDF2 hash), 12-hour signed sessions, lockout for 15 minutes after 5 wrong passwords; changing the password signs out every device.
- Requests from other websites are blocked; strict Content-Security-Policy and other security headers on every page; billing is never cached or indexed.
- Enquiry forms: hidden bot trap and max 5 messages per hour per visitor.

**Forgot something?**

```bash
# show the secret billing address
npx wrangler d1 execute neutech --remote --command "SELECT value FROM settings WHERE key='admin_path'"
# reset the password (then open the billing address and use SETUP_CODE again)
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
src/                  server code: billing API, login, invoice PDF, e-Way Bill, enquiry forms, backups
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
