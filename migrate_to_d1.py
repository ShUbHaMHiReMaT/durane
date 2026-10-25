"""Copies existing data from the old local database (gst_billing/billing.db) into the Cloudflare D1 database.

  python migrate_to_d1.py                      -> writes migration.sql
  npx wrangler d1 execute neutech --remote --file=migration.sql

Copies companies, clients, products, invoices, website enquiries and bill settings (terms, GST defaults,
e-Way Bill limit). It does NOT copy the password, login keys or the secret billing address: those are set up
fresh on Cloudflare. Run it once, right after the first deployment, before creating new bills there.
Delete migration.sql afterwards: it contains your business data.
"""
import os
import sqlite3

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "gst_billing", "billing.db")
OUT = os.path.join(ROOT, "migration.sql")
TABLES = ["companies", "clients", "products", "invoices", "enquiries"]
SETTINGS = ("terms", "default_igst", "default_cgst", "default_sgst", "eway_threshold")


def sql_value(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f"No database found at {SRC}")
    con = sqlite3.connect(SRC)
    con.row_factory = sqlite3.Row
    lines = []
    for table in TABLES:
        rows = con.execute(f"SELECT * FROM {table}").fetchall()
        lines.append(f"DELETE FROM {table};")
        for r in rows:
            cols = r.keys()
            if table == "companies" and r["logo"] not in ("", "omkar.png"):
                # uploaded logos are not copied: upload them again in Settings
                r = dict(r)
                r["logo"] = ""
                cols = list(r.keys())
            lines.append(f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join(sql_value(r[c]) for c in cols)});")
        print(f"{table}: {len(rows)}")
    for key in SETTINGS:
        r = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if r:
            lines.append(f"INSERT OR REPLACE INTO settings (key, value) VALUES ({sql_value(key)}, {sql_value(r['value'])});")
    with open(OUT, "w", encoding="utf8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
